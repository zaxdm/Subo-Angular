type Json = Record<string, unknown>;

const text = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);
const optionalText = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const number = (value: unknown, fallback = 0): number => (typeof value === 'number' ? value : fallback);
const optionalNumber = (value: unknown): number | null => (typeof value === 'number' ? value : null);
const list = (value: unknown): Json[] => (Array.isArray(value) ? (value as Json[]) : []);

/** Fallo con un mensaje listo para enseñar. */
export class ApiError extends Error {
  /** La sesión ya no vale: hay que volver a entrar. */
  readonly unauthorized: boolean;

  /** La cuenta existe, pero no tiene permiso para eso. */
  readonly forbidden: boolean;

  constructor(message: string, options: { unauthorized?: boolean; forbidden?: boolean } = {}) {
    super(message);
    this.unauthorized = options.unauthorized ?? false;
    this.forbidden = options.forbidden ?? false;
  }
}

/** El mensaje de [error] si es del servidor; si no, [fallback]. */
export function messageOf(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/** La cuenta con la que se entró. */
export interface Session {
  name: string;

  /** `false`: un pasajero, que no ve el panel de administración. */
  isAdmin: boolean;

  /** El administrador principal: el único que da o quita el acceso a los demás. */
  isSuperAdmin: boolean;

  /** Vacío si el servidor no lo dijo. */
  email: string;

  /** La foto de perfil; `null` si no tiene. */
  avatarUrl: string | null;
}

/** La sesión de la cuenta que describe el servidor en [user]. Lo que [user] no traiga se toma de [fallback]. */
export function sessionOf(user: Json, fallback: Session): Session {
  const role = user['role'];
  return {
    name: text(user['displayName'], fallback.name),
    isAdmin: role == null ? fallback.isAdmin : role === 'admin' || role === 'super_admin',
    isSuperAdmin: role == null ? fallback.isSuperAdmin : role === 'super_admin',
    email: text(user['email'], fallback.email),
    avatarUrl: 'avatarUrl' in user ? optionalText(user['avatarUrl']) : fallback.avatarUrl,
  };
}

/** Un punto del mapa. */
export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/** Un punto de referencia: un punto con nombre. */
export interface RouteStop extends GeoPoint {
  name: string;
}

const pointOf = (json: Json): GeoPoint => ({
  latitude: number(json['latitude']),
  longitude: number(json['longitude']),
});

/** Estados de una ruta en el catálogo, con el código que guarda el servidor. */
export type RouteStatus = 'APPROVED' | 'PENDING' | 'REJECTED';

export const ROUTE_STATUSES: { code: RouteStatus; label: string }[] = [
  { code: 'APPROVED', label: 'Publicada' },
  { code: 'PENDING', label: 'Pendiente' },
  { code: 'REJECTED', label: 'Oculta' },
];

export const routeStatusLabel = (status: RouteStatus): string =>
  ROUTE_STATUSES.find((item) => item.code === status)?.label ?? '';

/** Una ruta del catálogo, tal como la devuelve y la recibe el servidor. */
export interface BusRoute {
  /** `null` en una ruta que todavía no se guardó. */
  id: string | null;
  letter: string;
  name: string;
  vehicleName: string;
  origin: string;
  destination: string;
  durationMinutes: number;
  fare: number;

  /** Pasajes reducidos y cada cuántos minutos pasa; `null` si no se saben. */
  fareSchool: number | null;
  fareUniversity: number | null;
  frequencyMinutes: number | null;
  schedule: string;
  description: string;
  imageUrl: string | null;
  bidirectional: boolean;
  status: RouteStatus;
  stops: RouteStop[];

  /** Trazado dibujado a mano; vacío si la app debe estimarlo entre puntos de referencia. */
  path: GeoPoint[];
}

export function routeFromJson(json: Json): BusRoute {
  const status = ROUTE_STATUSES.find((item) => item.code === json['status'])?.code ?? 'APPROVED';
  const imageUrl = text(json['imageUrl']).trim();
  return {
    id: optionalText(json['id']),
    letter: text(json['letter']),
    name: text(json['name']),
    vehicleName: text(json['vehicleName']),
    origin: text(json['origin']),
    destination: text(json['destination']),
    durationMinutes: Math.trunc(number(json['durationMinutes'])),
    fare: number(json['fare']),
    fareSchool: optionalNumber(json['fareSchool']),
    fareUniversity: optionalNumber(json['fareUniversity']),
    frequencyMinutes: optionalNumber(json['frequencyMinutes']),
    schedule: text(json['schedule']),
    description: text(json['description']),
    imageUrl: imageUrl === '' ? null : imageUrl,
    bidirectional: json['bidirectional'] !== false,
    status,
    stops: list(json['stops']).map((stop) => ({ name: text(stop['name']), ...pointOf(stop) })),
    path: list(json['path']).map(pointOf),
  };
}

export function routeToJson(route: BusRoute): Json {
  return {
    letter: route.letter.trim(),
    name: route.name.trim(),
    vehicleName: route.vehicleName.trim(),
    origin: route.origin.trim(),
    destination: route.destination.trim(),
    durationMinutes: route.durationMinutes,
    fare: route.fare,
    fareSchool: route.fareSchool,
    fareUniversity: route.fareUniversity,
    frequencyMinutes: route.frequencyMinutes,
    schedule: route.schedule.trim(),
    description: route.description.trim(),
    imageUrl: route.imageUrl,
    bidirectional: route.bidirectional,
    status: route.status,
    stops: route.stops.map((stop) => ({
      name: stop.name.trim(),
      latitude: stop.latitude,
      longitude: stop.longitude,
    })),
    // Un trazado necesita al menos dos puntos; si no, la app lo estima.
    path: route.path.length >= 2 ? route.path.map(({ latitude, longitude }) => ({ latitude, longitude })) : null,
    pathSnapped: false,
  };
}

/** Una ruta en blanco, para el editor. */
export const newRoute = (): BusRoute => routeFromJson({});

/** Copia independiente, para editar sin tocar la del catálogo hasta guardar. */
export const copyRoute = (route: BusRoute): BusRoute => routeFromJson({ ...routeToJson(route), id: route.id });

/** [url] solo si es segura de cargar (HTTPS). */
export function safeUrl(url: string | null | undefined): string | null {
  try {
    return url && new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** «B · Huanchaco», o solo el nombre si la línea no tiene letra. */
export const routeTitle = (route: BusRoute): string =>
  route.letter === '' ? route.name : `${route.letter} · ${route.name}`;

const ALERT_LABELS: Record<string, string> = {
  TRAFFIC: 'Tráfico',
  ACCIDENT: 'Accidente',
  OVERCHARGE: 'Cobro de más',
  ROADWORK: 'Obras',
  CROWDED: 'Micro lleno',
  DANGER: 'Zona peligrosa',
  OTHER: 'Otro',
};

/** El tipo de una alerta, dicho como en la app. */
export const alertLabel = (type: string, fallback = 'Aviso'): string => ALERT_LABELS[type] ?? fallback;

/** Un aviso de la calle: tráfico, un accidente, obras… */
export interface CityAlert extends GeoPoint {
  id: string;
  type: string;
  label: string;
  placeName: string | null;
  comment: string | null;

  /** Cuánta gente dijo que sigue ahí. */
  confirmations: number;
}

export function alertFromJson(json: Json): CityAlert {
  const type = text(json['type']);
  return {
    id: text(json['id']),
    type,
    // «Otro» solo se dice en las estadísticas: en el mapa es un aviso sin más.
    label: type === 'OTHER' ? 'Aviso' : alertLabel(type),
    ...pointOf(json),
    placeName: optionalText(json['placeName']),
    comment: optionalText(json['comment']),
    confirmations: Math.trunc(number(json['confirmations'])),
  };
}

/** Una línea que deja cerca de un destino. */
export interface DestinationLine {
  routeId: string;

  /** Lo que hay que andar al bajarse, en metros. */
  alightMeters: number;

  /** Lo que hay que andar para subirse; `null` si no se sabe de dónde se sale. */
  boardMeters: number | null;

  /** Pasa por el destino antes que por donde se sube. */
  wrongWay: boolean;
}

/** El sitio que alguien buscó y las líneas que llevan hasta él, la mejor primero. */
export interface Destination extends GeoPoint {
  name: string;
  lines: DestinationLine[];

  /** Ninguna deja a distancia de caminata: las líneas son solo las que más se acercan. */
  far: boolean;
}

/** Lo que contesta el asistente y las líneas que recomienda, la mejor primero. */
export interface AssistantAnswer {
  text: string;
  routeIds: string[];
}

/** En qué va una sugerencia del buzón, con el código que guarda el servidor. */
export type SuggestionStatus = 'NEW' | 'IN_REVIEW' | 'RESOLVED';

export const SUGGESTION_STATUSES: { code: SuggestionStatus; label: string }[] = [
  { code: 'NEW', label: 'Nueva' },
  { code: 'IN_REVIEW', label: 'En revisión' },
  { code: 'RESOLVED', label: 'Resuelta' },
];

/** Una sugerencia que alguien mandó desde Soporte en la app o desde Contacto. */
export interface Suggestion {
  id: string;
  subject: string;
  message: string;
  createdAt: Date;
  appVersion: string;
  device: string;
  status: SuggestionStatus;

  /** Lo que se le contestó; quien la escribió lo ve en la app. */
  reply: string | null;

  /** `null` si la cuenta que la mandó ya no existe. */
  userName: string | null;
  userEmail: string | null;
}

export function suggestionFromJson(json: Json): Suggestion {
  return {
    id: text(json['id']),
    subject: text(json['subject']),
    message: text(json['message']),
    createdAt: new Date(number(json['createdAt'])),
    appVersion: text(json['appVersion']),
    device: text(json['device']),
    status: SUGGESTION_STATUSES.find((item) => item.code === json['status'])?.code ?? 'NEW',
    reply: optionalText(json['reply']),
    userName: optionalText(json['userName']),
    userEmail: optionalText(json['userEmail']),
  };
}

/** Una alerta vigente, con quién la publicó: lo que hace falta para moderarla. */
export interface ModerationAlert {
  alert: CityAlert;
  authorId: string;
  createdAt: Date;
  authorName: string | null;
  authorEmail: string | null;
  authorBlocked: boolean;
  imageUrl: string | null;
  dismissals: number;

  /** TRUSTED, NEW o UNRELIABLE, según cómo le fue con sus alertas anteriores. */
  reputation: string;
}

export function moderationAlertFromJson(json: Json): ModerationAlert {
  return {
    alert: alertFromJson(json),
    authorId: text(json['authorId']),
    createdAt: new Date(number(json['createdAt'])),
    authorName: optionalText(json['authorName']),
    authorEmail: optionalText(json['authorEmail']),
    authorBlocked: json['authorBlocked'] === true,
    imageUrl: optionalText(json['imageUrl']),
    dismissals: Math.trunc(number(json['dismissals'])),
    reputation: text(json['authorReputation'], 'NEW'),
  };
}

/** El resumen de uso que enseña el panel. */
export interface Stats {
  users: number;
  newUsersThisWeek: number;
  activeAlerts: number;
  ratings: number;
  pendingRoutes: number;
  newFeedback: number;

  /** Alertas de los últimos 7 días, por tipo. */
  alertsThisWeek: Record<string, number>;

  /** Alertas de los últimos 30 días por hora del día (0-23), en hora de Perú. */
  alertsByHour: number[];

  /** Las rutas más abiertas en los últimos 30 días. */
  topRoutes: { name: string; letter: string; views: number }[];
}

export function statsFromJson(json: Json): Stats {
  const week = (json['alertsThisWeek'] ?? {}) as Record<string, unknown>;
  return {
    users: number(json['users']),
    newUsersThisWeek: number(json['newUsersThisWeek']),
    activeAlerts: number(json['activeAlerts']),
    ratings: number(json['ratings']),
    pendingRoutes: number(json['pendingRoutes']),
    newFeedback: number(json['newFeedback']),
    alertsThisWeek: Object.fromEntries(Object.entries(week).map(([type, count]) => [type, number(count)])),
    alertsByHour: (Array.isArray(json['alertsByHour']) ? json['alertsByHour'] : []).map((count) => number(count)),
    topRoutes: list(json['topRoutes']).map((route) => ({
      name: text(route['name']),
      letter: text(route['letter']),
      views: number(route['views']),
    })),
  };
}

/** Un número del periodo y el del periodo anterior, de la misma duración. */
export interface Compared {
  value: number;
  previous: number;
}

/** Un día del tablero, en hora de Perú. */
export interface DayStats {
  day: string;
  android: number;
  web: number;
  signedIn: number;
  newUsers: number;
  downloads: number;
  alerts: number;
}

/** El tablero de estadísticas para un periodo de días. */
export interface Dashboard {
  days: number;
  /** Desde qué día se cuentan las visitas; antes no hay registro. */
  trackingSince: string | null;
  totals: {
    users: number;
    newUsers: Compared;
    activeAccounts: Compared;
    dailyVisitors: Compared;
    visitorsToday: number;
    downloads: Compared;
    alerts: Compared;
    assistantQuestions: Compared;
    premium: number;
    publishedRoutes: number;
    pendingRoutes: number;
    newFeedback: number;
    ratings: number;
  };
  series: DayStats[];
  platforms: { android: number; web: number };
  downloadsByDevice: Record<string, number>;
  topRoutes: { id: string; name: string; letter: string; views: number }[];
  alertsByType: Record<string, number>;
  alertsByHour: number[];
  recentUsers: AdminUser[];
}

export type Platform = 'android' | 'web';

/** Una cuenta, vista desde el panel. */
export interface AdminUser {
  id: string;
  name: string;
  email: string;
  createdAt: number;
  /** La última vez que entró con sesión; `null` si no hay registro. */
  lastSeenAt: number | null;
  lastPlatform: Platform | null;
  isAdmin: boolean;
  isPremium: boolean;
  blocked: boolean;
  emailVerified: boolean;
  google: boolean;
  alerts: number;
  ratings: number;
}

export const USER_FILTERS = [
  { code: 'all', label: 'Todas' },
  { code: 'active', label: 'Activas (30 días)' },
  { code: 'new', label: 'Nuevas (7 días)' },
  { code: 'inactive', label: 'Sin actividad' },
  { code: 'premium', label: 'Premium' },
  { code: 'unverified', label: 'Sin verificar' },
  { code: 'blocked', label: 'Bloqueadas' },
  { code: 'admins', label: 'Administradores' },
] as const;
export type UserFilter = (typeof USER_FILTERS)[number]['code'];

export const USER_SORTS = [
  { code: 'recent', label: 'Más recientes' },
  { code: 'lastSeen', label: 'Última visita' },
  { code: 'name', label: 'Nombre' },
  { code: 'alerts', label: 'Más alertas' },
] as const;
export type UserSort = (typeof USER_SORTS)[number]['code'];

export interface UserList {
  users: AdminUser[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<UserFilter, number>;
}

const compared = (value: unknown): Compared => {
  const json = (value ?? {}) as Json;
  return { value: number(json['value']), previous: number(json['previous']) };
};

const counts = (value: unknown): Record<string, number> =>
  Object.fromEntries(Object.entries((value ?? {}) as Json).map(([key, count]) => [key, number(count)]));

export function adminUserFromJson(json: Json): AdminUser {
  const platform = json['lastPlatform'];
  return {
    id: text(json['id']),
    name: text(json['name']),
    email: text(json['email']),
    createdAt: number(json['createdAt']),
    lastSeenAt: optionalNumber(json['lastSeenAt']),
    lastPlatform: platform === 'android' || platform === 'web' ? platform : null,
    isAdmin: json['isAdmin'] === true,
    isPremium: json['isPremium'] === true,
    blocked: json['blocked'] === true,
    emailVerified: json['emailVerified'] === true,
    google: json['google'] === true,
    alerts: number(json['alerts']),
    ratings: number(json['ratings']),
  };
}

export function dashboardFromJson(json: Json): Dashboard {
  const totals = (json['totals'] ?? {}) as Json;
  const platforms = (json['platforms'] ?? {}) as Json;
  return {
    days: number(json['days']),
    trackingSince: optionalText(json['trackingSince']),
    totals: {
      users: number(totals['users']),
      newUsers: compared(totals['newUsers']),
      activeAccounts: compared(totals['activeAccounts']),
      dailyVisitors: compared(totals['dailyVisitors']),
      visitorsToday: number(totals['visitorsToday']),
      downloads: compared(totals['downloads']),
      alerts: compared(totals['alerts']),
      assistantQuestions: compared(totals['assistantQuestions']),
      premium: number(totals['premium']),
      publishedRoutes: number(totals['publishedRoutes']),
      pendingRoutes: number(totals['pendingRoutes']),
      newFeedback: number(totals['newFeedback']),
      ratings: number(totals['ratings']),
    },
    series: list(json['series']).map((day) => ({
      day: text(day['day']),
      android: number(day['android']),
      web: number(day['web']),
      signedIn: number(day['signedIn']),
      newUsers: number(day['newUsers']),
      downloads: number(day['downloads']),
      alerts: number(day['alerts']),
    })),
    platforms: { android: number(platforms['android']), web: number(platforms['web']) },
    downloadsByDevice: counts(json['downloadsByDevice']),
    topRoutes: list(json['topRoutes']).map((route) => ({
      id: text(route['id']),
      name: text(route['name']),
      letter: text(route['letter']),
      views: number(route['views']),
    })),
    alertsByType: counts(json['alertsByType']),
    alertsByHour: (Array.isArray(json['alertsByHour']) ? json['alertsByHour'] : []).map((count) => number(count)),
    recentUsers: list(json['recentUsers']).map(adminUserFromJson),
  };
}

export function userListFromJson(json: Json): UserList {
  const all = (json['counts'] ?? {}) as Json;
  return {
    users: list(json['users']).map(adminUserFromJson),
    total: number(json['total']),
    page: number(json['page']),
    pageSize: number(json['pageSize'], 25),
    counts: Object.fromEntries(USER_FILTERS.map(({ code }) => [code, number(all[code])])) as Record<UserFilter, number>,
  };
}

/** Una cuenta con acceso al panel. */
export interface Admin {
  id: string;
  name: string;
  email: string;

  /** El administrador principal: a él no se le quita el acceso. */
  isPrincipal: boolean;
}

export function adminFromJson(json: Json): Admin {
  return {
    id: text(json['id']),
    name: text(json['displayName']),
    email: text(json['email']),
    isPrincipal: json['role'] === 'super_admin',
  };
}

/** Una cuenta con Subo Premium y hasta cuándo lo tiene. */
export interface PremiumAccount {
  id: string;
  name: string;
  email: string;
  until: Date;
}

export function premiumAccountFromJson(json: Json): PremiumAccount {
  return {
    id: text(json['id']),
    name: text(json['displayName']),
    email: text(json['email']),
    until: new Date(Number(json['premiumUntil'] ?? 0)),
  };
}

/** Un plan de Premium: cuántos días da y cuánto cuesta, en soles. */
export interface PaymentPlan {
  days: number;
  price: number;
}

/** A qué QR de Yape se paga Premium y cuánto cuesta. */
export interface PaymentConfig {
  /** La imagen del QR; `null` mientras no se haya subido. */
  qrUrl: string | null;

  /** A nombre de quién sale el Yape. */
  holder: string;
  plans: PaymentPlan[];
}

export function paymentConfigFromJson(json: Json): PaymentConfig {
  const plans = Array.isArray(json['plans']) ? (json['plans'] as Json[]) : [];
  return {
    qrUrl: typeof json['qrUrl'] === 'string' ? json['qrUrl'] : null,
    holder: text(json['holder']),
    plans: plans.map((plan) => ({ days: Number(plan['days']), price: Number(plan['price']) })),
  };
}

/** El comprobante de un pago de Premium que alguien subió desde la app. */
export interface PremiumPayment {
  id: string;
  days: number;
  amount: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  note: string;
  createdAt: Date;
  imageUrl: string;
  userName: string;
  userEmail: string;
}

export function premiumPaymentFromJson(json: Json): PremiumPayment {
  const status = text(json['status']);
  return {
    id: text(json['id']),
    days: Number(json['days'] ?? 0),
    amount: Number(json['amount'] ?? 0),
    status: status === 'APPROVED' || status === 'REJECTED' ? status : 'PENDING',
    note: text(json['note']),
    createdAt: new Date(Number(json['createdAt'] ?? 0)),
    imageUrl: text(json['imageUrl']),
    userName: text(json['userName']),
    userEmail: text(json['userEmail']),
  };
}

/** "10/10/2026", en la hora de quien mira el panel. */
export function formatDate(date: Date): string {
  const two = (value: number) => String(value).padStart(2, '0');
  return `${two(date.getDate())}/${two(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/** "10/10/2026 16:05", en la hora de quien mira el panel. */
export function formatDateTime(date: Date): string {
  const two = (value: number) => String(value).padStart(2, '0');
  return `${two(date.getDate())}/${two(date.getMonth() + 1)}/${date.getFullYear()} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** El tipo de una foto si es de los que acepta el servidor; `null` si no. */
export function imageTypeOf(file: File): string | null {
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (allowed.includes(file.type)) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  return null;
}

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
