import { Service, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { Api } from './api';
import { ApiError, BusRoute, Session, messageOf } from './models';
import { Ui } from './ui';

/**
 * Lo que comparten todas las pantallas: quién entró, las líneas publicadas y
 * el catálogo del panel.
 *
 * Cualquiera entra directo a la web de los pasajeros: el mapa con las líneas
 * y las páginas de información. Con una cuenta de administrador se pasa al
 * panel: el catálogo, el editor de una ruta o el buzón.
 */
@Service()
export class Store {
  private readonly api = inject(Api);
  private readonly ui = inject(Ui);
  private readonly router = inject(Router);

  /** Quién entró; `null` sin sesión. */
  readonly session = signal<Session | null>(null);
  readonly isAdmin = computed(() => this.session()?.isAdmin ?? false);

  // --- La web de los pasajeros ---

  /** Las líneas publicadas, las que ve todo el mundo. */
  readonly lines = signal<BusRoute[]>([]);
  readonly loadingLines = signal(true);
  readonly linesError = signal<string | null>(null);

  /** La ventana de acceso está abierta sobre la página. */
  readonly loginOpen = signal(false);

  /** La línea que alguien quiso abrir sin sesión: se abre al entrar. */
  readonly wantedLine = signal<string | null>(null);

  // --- El panel de administración ---

  /** El catálogo completo, con las rutas pendientes y ocultas. */
  readonly routes = signal<BusRoute[]>([]);

  /** La ruta abierta en el editor; `null` si se ve el catálogo. */
  readonly editing = signal<BusRoute | null>(null);

  /**
   * Antes de enseñar nada se mira si este navegador ya tenía una sesión: así
   * quien recarga la página sigue donde estaba.
   */
  async start(): Promise<void> {
    const session = await this.api.restore();
    if (session?.isAdmin) {
      try {
        this.routes.set(await this.api.routes());
      } catch (error) {
        this.onError(error);
      }
    }
    // Si la sesión caducó justo ahora, `onError` ya la cerró.
    if (this.api.isSignedIn) this.session.set(session);
    // El administrador carga las líneas al salir del panel a la web.
    if (!this.isAdmin()) void this.loadLines();
  }

  async loadLines(): Promise<void> {
    this.loadingLines.set(true);
    this.linesError.set(null);
    try {
      this.lines.set(await this.api.publicRoutes());
    } catch (error) {
      this.linesError.set(messageOf(error, 'No se pudieron cargar las líneas.'));
    } finally {
      this.loadingLines.set(false);
    }
  }

  /** Se entró desde la ventana de acceso, con lo que le toca ver a esa cuenta ya cargado. */
  signedIn(session: Session, routes: BusRoute[]): void {
    const wanted = this.wantedLine();
    this.session.set(session);
    this.loginOpen.set(false);
    this.wantedLine.set(null);
    if (session.isAdmin) {
      this.routes.set(routes);
      void this.router.navigate(['/panel']);
      this.ui.notify('Sesión iniciada. El catálogo está actualizado.');
      return;
    }
    this.lines.set(routes);
    this.loadingLines.set(false);
    this.linesError.set(null);
    // Vuelve a donde estaba, con la línea que quería ver ya abierta.
    if (wanted !== null) void this.router.navigate(['/ruta', wanted]);
  }

  signOut(): void {
    this.api.signOut();
    this.session.set(null);
    this.routes.set([]);
    this.editing.set(null);
    this.wantedLine.set(null);
    void this.router.navigate(['/']);
    // Lo que cambió el administrador ya se ve en el mapa.
    void this.loadLines();
  }

  /** Abre el recorrido de una línea (o vuelve a todas con `null`). Abrirlo pide sesión. */
  selectLine(id: string | null): void {
    if (id !== null && this.session() === null) {
      this.wantedLine.set(id);
      this.loginOpen.set(true);
      return;
    }
    void this.router.navigate(id === null ? ['/mapa'] : ['/ruta', id]);
  }

  /** El acceso es una ventana sobre la página: al cerrarla se sigue donde se estaba. */
  openLogin(): void {
    this.loginOpen.set(true);
  }

  closeLogin(): void {
    this.loginOpen.set(false);
    // Si cerró sin entrar, se olvida la línea que quería ver.
    this.wantedLine.set(null);
  }

  /** Enseña el fallo y, si la sesión caducó, vuelve a pedir que se entre. */
  onError(error: unknown): void {
    this.ui.notify(messageOf(error, 'Algo falló. Inténtalo de nuevo.'), 'error');
    if (error instanceof ApiError && error.unauthorized) this.signOut();
  }

  /** Vuelve a pedir el catálogo del panel. */
  async refresh(): Promise<void> {
    try {
      this.routes.set(await this.api.routes());
      this.ui.notify('Catálogo actualizado.');
    } catch (error) {
      this.onError(error);
    }
  }

  saved(route: BusRoute): void {
    this.routes.update((routes) => [route, ...routes.filter((other) => other.id !== route.id)]);
    this.editing.set(null);
    this.ui.notify('Ruta guardada. Las publicadas llegan a la app cuando actualice su catálogo.');
  }

  deleted(id: string): void {
    this.routes.update((routes) => routes.filter((route) => route.id !== id));
    this.editing.set(null);
    this.ui.notify('Ruta eliminada.');
  }
}
