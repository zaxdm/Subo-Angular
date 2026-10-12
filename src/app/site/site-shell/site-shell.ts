import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';

import { Store } from '../../core/store';
import { SuboMark } from '../../shared/subo-mark/subo-mark';
import { SiteFooter } from '../site-footer/site-footer';

/** Una página de la web pública y su dirección. */
interface NavPage {
  label: string;
  path: string;
}

/**
 * El marco de la web de los pasajeros: la barra de arriba con la marca y la
 * cuenta y, en el mapa, una franja de pie siempre a la vista. Las páginas de
 * texto llevan el pie completo al final de su contenido.
 */
@Component({
  imports: [RouterOutlet, RouterLink, SuboMark, SiteFooter],
  selector: 'app-site-shell',
  styleUrl: './site-shell.css',
  templateUrl: './site-shell.html',
  host: { '[class.on-map]': 'onMap()' },
})
export class SiteShell {
  protected readonly store = inject(Store);
  private readonly router = inject(Router);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  /** La dirección sin parámetros: `/mapa`, `/contacto`… */
  private readonly path = computed(() => this.url().split(/[?#]/)[0]);

  /** El mapa ocupa toda la pantalla, así que su pie es una franja. */
  protected readonly onMap = computed(() => this.path() === '/mapa' || this.path().startsWith('/ruta/'));
  protected readonly onProfile = computed(() => this.path() === '/perfil');

  /** Las páginas que caben en la barra de arriba; las legales van en el pie. El perfil solo está con sesión. */
  protected readonly navPages = computed<NavPage[]>(() => [
    { label: 'Inicio', path: '/' },
    { label: 'Mapa', path: '/mapa' },
    { label: 'Descargar app', path: '/descargar' },
    { label: 'Contacto', path: '/contacto' },
    ...(this.store.session() === null ? [] : [{ label: 'Mi perfil', path: '/perfil' }]),
  ]);

  protected readonly barPages: NavPage[] = [
    { label: 'Inicio', path: '/' },
    { label: 'Descargar app', path: '/descargar' },
    { label: 'Privacidad', path: '/privacidad' },
    { label: 'Términos', path: '/terminos' },
    { label: 'Contacto', path: '/contacto' },
  ];

  /** El menú de las pantallas estrechas está desplegado. */
  protected readonly menuOpen = signal(false);

  constructor() {
    // El administrador sale del panel a la web con su misma sesión: lo que
    // cambió en el panel ya se ve en el mapa.
    if (this.store.isAdmin()) void this.store.loadLines();
  }

  protected isCurrent(page: NavPage): boolean {
    return page.path === '/mapa' ? this.onMap() : this.path() === page.path;
  }
}
