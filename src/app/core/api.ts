import { Service } from '@angular/core';

import {
  Admin,
  ApiError,
  AssistantAnswer,
  BusRoute,
  CityAlert,
  Destination,
  GeoPoint,
  ModerationAlert,
  Session,
  Stats,
  Suggestion,
  SuggestionStatus,
  adminFromJson,
  PremiumAccount,
  premiumAccountFromJson,
  PaymentConfig,
  PremiumPayment,
  paymentConfigFromJson,
  premiumPaymentFromJson,
  alertFromJson,
  moderationAlertFromJson,
  routeFromJson,
  routeToJson,
  sessionOf,
  statsFromJson,
  Dashboard,
  dashboardFromJson,
  UserFilter,
  UserList,
  userListFromJson,
  UserSort,
  suggestionFromJson,
} from './models';
import { SiteInfo } from './site-info';
import { load, save } from './storage';

type Json = Record<string, unknown>;

const TIMEOUT_MS = 30_000;
const TOKEN_KEY = 'session_token';

const items = (value: unknown): Json[] => (Array.isArray(value) ? (value as Json[]) : []);

/**
 * Habla con el servidor. La sesión se guarda en el navegador: al recargar la
 * página se sigue dentro hasta cerrar sesión o hasta que caduque.
 */
@Service()
export class Api {
  private token: string | null = null;

  get isSignedIn(): boolean {
    return this.token !== null;
  }

  /** Recupera la sesión guardada en este navegador; `null` si no hay ninguna o ya no vale. */
  async restore(): Promise<Session | null> {
    const token = load(TOKEN_KEY);
    if (token === null) return null;
    this.token = token;
    try {
      const user = await this.send('GET', '/api/me');
      return sessionOf(user, {
        name: 'Tu cuenta',
        isAdmin: false,
        isSuperAdmin: false,
        email: '',
        avatarUrl: null,
      });
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      // Caducada ya se borró al recibir el 401; si solo falló la conexión, se
      // queda guardada para la próxima vez.
      this.token = null;
      return null;
    }
  }

  /**
   * Entra con una cuenta. Todos usan el mismo acceso: es el servidor quien
   * dice si la cuenta es de administrador o de pasajero.
   */
  signIn(email: string, password: string): Promise<Session> {
    return this.open('/api/auth/login', { email: email.trim(), password }, email);
  }

  /** El desafío de un solo uso con el que se firma un acceso con Google. */
  async googleChallenge(): Promise<string> {
    const data = await this.send('POST', '/api/auth/google/challenge');
    const nonce = data['nonce'];
    if (typeof nonce !== 'string') throw new ApiError('El acceso con Google no está disponible ahora.');
    return nonce;
  }

  /**
   * Entra con la credencial que dio Google. Si el correo ya tenía cuenta con
   * contraseña, el servidor pide esa contraseña ([existingPassword]) para
   * unirlas.
   */
  signInWithGoogle(idToken: string, nonce: string, existingPassword = ''): Promise<Session> {
    const body: Json = { idToken, nonce };
    if (existingPassword !== '') body['existingPassword'] = existingPassword;
    return this.open('/api/auth/google', body, 'Tu cuenta');
  }

  /**
   * Pide una cuenta de pasajero. Por aquí nunca sale una cuenta de
   * administrador: esas las da el administrador principal.
   *
   * Devuelve `null` si el servidor mandó un código al correo: la cuenta se
   * crea al confirmarlo con [confirmRegistration]. Si no pide confirmar,
   * devuelve la sesión ya abierta.
   */
  async register(displayName: string, email: string, password: string): Promise<Session | null> {
    this.token = null;
    const opened = await this.send('POST', '/api/auth/register', {
      body: { displayName: displayName.trim(), email: email.trim(), password },
    });
    if (opened['verificationRequired'] === true) return null;
    return this.adopt(opened, email);
  }

  /** El segundo paso del registro: con el código que llegó al correo, la cuenta se crea y se entra con ella. */
  confirmRegistration(email: string, code: string): Promise<Session> {
    return this.open('/api/auth/register/verify', { email: email.trim(), code: code.trim() }, email);
  }

  private async open(path: string, body: Json, email: string): Promise<Session> {
    this.token = null;
    return this.adopt(await this.send('POST', path, { body }), email);
  }

  /** Se queda con la sesión que abrió el servidor y mira de qué tipo es la cuenta. */
  private async adopt(opened: Json, email: string): Promise<Session> {
    try {
      const token = opened['token'];
      if (typeof token !== 'string') throw new ApiError('El servidor no devolvió una sesión. Revisa su dirección.');
      this.token = token;
      const user = opened['user'];
      const passenger = sessionOf(user !== null && typeof user === 'object' ? { ...user, role: 'client' } : {}, {
        name: email.trim(),
        isAdmin: false,
        isSuperAdmin: false,
        email: email.includes('@') ? email.trim() : '',
        avatarUrl: null,
      });
      let session: Session;
      try {
        session = sessionOf(await this.send('GET', '/api/admin/me'), {
          ...passenger,
          isAdmin: true,
        });
      } catch (error) {
        // Que no sea administrador no es un fallo: es un pasajero.
        if (!(error instanceof ApiError && error.forbidden)) throw error;
        session = passenger;
      }
      save(TOKEN_KEY, this.token);
      return session;
    } catch (error) {
      this.token = null;
      throw error;
    }
  }

  signOut(): void {
    this.token = null;
    save(TOKEN_KEY, null);
  }

  /** Las líneas publicadas, tal como las ve cualquier pasajero. No pide sesión. */
  async publicRoutes(): Promise<BusRoute[]> {
    return items((await this.send('GET', '/api/routes'))['routes']).map(routeFromJson);
  }

  /** El catálogo completo, con las rutas pendientes y ocultas. */
  async routes(): Promise<BusRoute[]> {
    return items((await this.send('GET', '/api/admin/routes'))['routes']).map(routeFromJson);
  }

  /** Crea la ruta o, si ya tiene id, la actualiza. Devuelve la versión guardada. */
  async saveRoute(route: BusRoute): Promise<BusRoute> {
    const body = routeToJson(route);
    const data =
      route.id === null
        ? await this.send('POST', '/api/admin/routes', { body })
        : await this.send('PUT', `/api/admin/routes/${encodeURIComponent(route.id)}`, { body });
    return routeFromJson(data);
  }

  async deleteRoute(id: string): Promise<void> {
    await this.send('DELETE', `/api/admin/routes/${encodeURIComponent(id)}`);
  }

  /** El buzón de sugerencias, de la más reciente a la más antigua. */
  async feedback(): Promise<Suggestion[]> {
    return items((await this.send('GET', '/api/admin/feedback'))['feedback']).map(suggestionFromJson);
  }

  async deleteFeedback(id: string): Promise<void> {
    await this.send('DELETE', `/api/admin/feedback/${encodeURIComponent(id)}`);
  }

  /** Cambia el estado de una sugerencia y, si se quiere, la contesta. */
  async reviewFeedback(id: string, status: SuggestionStatus, reply: string | null): Promise<void> {
    await this.send('PUT', `/api/admin/feedback/${encodeURIComponent(id)}`, {
      body: { status, reply },
    });
  }

  /** Las alertas vigentes, también las de cuentas bloqueadas. */
  async moderationAlerts(): Promise<ModerationAlert[]> {
    return items((await this.send('GET', '/api/admin/alerts'))['alerts']).map(moderationAlertFromJson);
  }

  async deleteAlert(id: string): Promise<void> {
    await this.send('DELETE', `/api/admin/alerts/${encodeURIComponent(id)}`);
  }

  /** Bloquea o desbloquea una cuenta: bloqueada no publica y lo suyo deja de verse. */
  async blockUser(id: string, blocked: boolean): Promise<void> {
    await this.send('POST', `/api/admin/users/${encodeURIComponent(id)}/block`, {
      body: { blocked },
    });
  }

  async dashboard(days: number): Promise<Dashboard> {
    return dashboardFromJson(await this.send('GET', `/api/admin/dashboard?days=${days}`));
  }

  async adminUsers(query: {
    search: string;
    filter: UserFilter;
    sort: UserSort;
    page: number;
    size: number;
  }): Promise<UserList> {
    const params = new URLSearchParams({
      q: query.search,
      filter: query.filter,
      sort: query.sort,
      page: String(query.page),
      size: String(query.size),
    });
    return userListFromJson(await this.send('GET', `/api/admin/users?${params}`));
  }

  async stats(): Promise<Stats> {
    return statsFromJson(await this.send('GET', '/api/admin/stats'));
  }

  /** Los administradores, con el principal primero. Solo los ve el principal. */
  async admins(): Promise<Admin[]> {
    return items((await this.send('GET', '/api/admin/admins'))['admins']).map(adminFromJson);
  }

  /** Da acceso al panel a una cuenta que ya existe. */
  async addAdmin(email: string): Promise<Admin> {
    return adminFromJson(await this.send('POST', '/api/admin/admins', { body: { email: email.trim() } }));
  }

  /** Quita el acceso: la cuenta sigue ahí, como la de cualquier pasajero. */
  async removeAdmin(id: string): Promise<void> {
    await this.send('DELETE', `/api/admin/admins/${encodeURIComponent(id)}`);
  }

  /** Las cuentas con Premium vigente, la que antes vence primero. Solo las ve el principal. */
  async premiumAccounts(): Promise<PremiumAccount[]> {
    return items((await this.send('GET', '/api/admin/premium'))['accounts']).map(premiumAccountFromJson);
  }

  /** Suma días de Premium a la cuenta de ese correo. */
  async addPremium(email: string, days: number): Promise<PremiumAccount> {
    return premiumAccountFromJson(
      await this.send('POST', '/api/admin/premium', { body: { email: email.trim(), days } }),
    );
  }

  /** Quita Premium: la cuenta vuelve a ser gratuita. */
  async removePremium(id: string): Promise<void> {
    await this.send('DELETE', `/api/admin/premium/${encodeURIComponent(id)}`);
  }

  /** A qué QR de Yape se paga Premium y cuánto cuesta cada plan. */
  async paymentConfig(): Promise<PaymentConfig> {
    return paymentConfigFromJson(await this.send('GET', '/api/premium/payment'));
  }

  /** Guarda el QR, a nombre de quién está y los precios. Devuelve lo que quedó guardado. */
  async savePaymentConfig(config: PaymentConfig): Promise<PaymentConfig> {
    return paymentConfigFromJson(await this.send('PUT', '/api/admin/premium/payment-config', { body: { ...config } }));
  }

  /** Los comprobantes de pago: los que esperan confirmación, primero. */
  async premiumPayments(): Promise<PremiumPayment[]> {
    return items((await this.send('GET', '/api/admin/premium/payments'))['payments']).map(premiumPaymentFromJson);
  }

  /** Confirma el pago (y activa Premium) o lo rechaza, con una nota para quien lo subió. */
  async reviewPayment(id: string, approved: boolean, note = ''): Promise<void> {
    await this.send('POST', `/api/admin/premium/payments/${encodeURIComponent(id)}/review`, {
      body: { approved, note },
    });
  }

  /** Sube la foto de una ruta y devuelve su dirección pública. */
  async uploadImage(file: Blob, contentType: string): Promise<string> {
    const data = await this.send('POST', '/api/admin/images', { file, contentType });
    return this.uploadedUrl(data);
  }

  /** Cambia el nombre de la cuenta con la que se entró. Devuelve la sesión al día. */
  async rename(session: Session, name: string): Promise<Session> {
    return sessionOf(await this.send('POST', '/api/me', { body: { displayName: name.trim() } }), session);
  }

  /** Sube una foto de perfil, que el servidor revisa, y la pone en la cuenta. */
  async changeAvatar(session: Session, file: Blob, contentType: string): Promise<Session> {
    const url = this.uploadedUrl(await this.send('POST', '/api/images?purpose=avatar', { file, contentType }));
    return sessionOf(await this.send('POST', '/api/me/avatar', { body: { avatarUrl: url } }), session);
  }

  async removeAvatar(session: Session): Promise<Session> {
    return sessionOf(await this.send('POST', '/api/me/avatar', { body: { avatarUrl: null } }), session);
  }

  private uploadedUrl(data: Json): string {
    const url = data['url'];
    if (typeof url !== 'string') throw new ApiError('El servidor no devolvió la dirección de la foto.');
    return url;
  }

  /** Las alertas que la gente dejó en la calle y siguen vigentes. No pide sesión. */
  async alerts(): Promise<CityAlert[]> {
    // Todo Trujillo desde su centro; el servidor recorta el radio a su máximo.
    const data = await this.send('GET', '/api/alerts?lat=-8.112&lon=-79.0288&radius=30000');
    return items(data['alerts']).map(alertFromJson);
  }

  /**
   * Busca en el mapa el sitio al que va alguien y las líneas que dejan cerca;
   * con [here], también cuánto hay que andar para subirse. `null` si el sitio
   * no sale en el mapa. No pide sesión.
   */
  async destination(query: string, here: GeoPoint | null = null): Promise<Destination | null> {
    const params = new URLSearchParams({ q: query.trim() });
    if (here !== null) {
      params.set('lat', String(here.latitude));
      params.set('lon', String(here.longitude));
    }
    const data = await this.send('GET', `/api/destinations?${params}`);
    const place = data['place'];
    if (place === null || typeof place !== 'object') return null;
    const { name, latitude, longitude } = place as Json;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
    return {
      name: typeof name === 'string' ? name : query.trim(),
      latitude,
      longitude,
      far: data['far'] === true,
      lines: items(data['lines']).flatMap((line) => {
        const { routeId, alightMeters, boardMeters } = line;
        if (typeof routeId !== 'string' || typeof alightMeters !== 'number') return [];
        return [
          {
            routeId,
            alightMeters,
            boardMeters: typeof boardMeters === 'number' ? boardMeters : null,
            wrongWay: line['wrongWay'] === true,
          },
        ];
      }),
    };
  }

  /**
   * Le pregunta al asistente. Pide sesión. Con [here], dónde está quien
   * pregunta, el asistente parte de ahí; [history] es lo ya hablado.
   */
  async ask(
    question: string,
    here: GeoPoint | null = null,
    history: { mine: boolean; text: string }[] = [],
  ): Promise<AssistantAnswer> {
    const data = await this.send('POST', '/api/assistant', {
      body: {
        question: question.trim(),
        language: 'es',
        history,
        ...(here ? { latitude: here.latitude, longitude: here.longitude } : {}),
      },
    });
    // Un servidor sin actualizar manda solo `routeId`, la única línea que recomendaba.
    const routeIds = data['routeIds'] ?? [data['routeId']];
    return {
      text: typeof data['answer'] === 'string' ? data['answer'] : '',
      routeIds: Array.isArray(routeIds) ? routeIds.filter((id) => typeof id === 'string') : [],
    };
  }

  /** Manda un mensaje al buzón del equipo. Pide sesión. */
  async sendFeedback(subject: string, message: string): Promise<void> {
    await this.send('POST', '/api/feedback', {
      body: { subject, message: message.trim(), appVersion: 'web' },
    });
  }

  private async send(
    method: string,
    path: string,
    payload: { body?: Json; file?: Blob; contentType?: string } = {},
  ): Promise<Json> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.token !== null) headers['Authorization'] = `Bearer ${this.token}`;
    let body: BodyInit | undefined;
    if (payload.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(payload.body);
    } else if (payload.file !== undefined) {
      headers['Content-Type'] = payload.contentType ?? 'application/octet-stream';
      body = payload.file;
    }

    let response: Response;
    let text: string;
    try {
      response = await fetch(SiteInfo.serverUrl + path, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      text = await response.text();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new ApiError('El servidor tardó demasiado en responder. Inténtalo de nuevo.');
      }
      throw new ApiError('No se pudo conectar con el servidor. Revisa tu conexión.');
    }

    let data: Json = {};
    if (text !== '') {
      try {
        const decoded: unknown = JSON.parse(text);
        if (decoded !== null && typeof decoded === 'object' && !Array.isArray(decoded)) data = decoded as Json;
      } catch {
        throw new ApiError('El servidor devolvió una respuesta inesperada.');
      }
    }

    if (!response.ok) {
      // Un 401 al entrar es una contraseña mala; en cualquier otro momento, la sesión caducó.
      const expired = response.status === 401 && !path.startsWith('/api/auth/');
      if (expired) this.signOut();
      const message = data['message'];
      throw new ApiError(
        typeof message === 'string' ? message : `No se pudo completar la operación (${response.status}).`,
        { unauthorized: expired, forbidden: response.status === 403 },
      );
    }
    return data;
  }
}
