import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes, UrlMatchResult, UrlSegment } from '@angular/router';

import { Store } from './core/store';
import { About } from './site/about/about';
import { SiteShell } from './site/site-shell/site-shell';

/**
 * El mapa atiende dos direcciones: `/mapa`, con todas las líneas, y
 * `/ruta/<id>`, con una abierta. Esta última es la que comparte la app. Al ser
 * una sola ruta, pasar de una a otra no rehace el mapa.
 */
export function mapMatcher(segments: UrlSegment[]): UrlMatchResult | null {
  if (segments.length === 1 && segments[0].path === 'mapa') return { consumed: segments };
  if (segments.length === 2 && segments[0].path === 'ruta' && segments[1].path !== '') {
    return { consumed: segments, posParams: { id: segments[1] } };
  }
  return null;
}

/** El panel es solo para administradores: los demás van a la portada. */
const adminOnly: CanActivateFn = () => inject(Store).isAdmin() || inject(Router).createUrlTree(['/']);

/** Quién más es administrador lo decide solo el principal. */
const principalOnly: CanActivateFn = () =>
  (inject(Store).session()?.isSuperAdmin ?? false) || inject(Router).createUrlTree(['/panel']);

const signedIn: CanActivateFn = () => inject(Store).session() !== null || inject(Router).createUrlTree(['/']);

/** Un administrador que abre la web empieza en su panel; desde ahí sale a verla. */
const panelFirst: CanActivateFn = () => {
  const router = inject(Router);
  return inject(Store).isAdmin() && !router.navigated ? router.createUrlTree(['/panel']) : true;
};

/**
 * Abrir el recorrido de una línea pide sesión. Quien llega sin ella por un
 * enlace compartido se queda en el mapa con todas, y se le ofrece entrar: al
 * hacerlo se abre la línea que quería ver.
 */
const lineNeedsSession: CanActivateFn = (route) => {
  const store = inject(Store);
  const id: string | undefined = route.params['id'];
  if (id === undefined || store.session() !== null) return true;
  store.wantedLine.set(id);
  store.openLogin();
  return inject(Router).createUrlTree(['/mapa']);
};

export const routes: Routes = [
  {
    path: 'panel',
    canActivate: [adminOnly],
    loadComponent: () => import('./admin/admin-shell/admin-shell').then((m) => m.AdminShell),
    children: [
      { path: '', loadComponent: () => import('./admin/catalog/catalog').then((m) => m.Catalog) },
      { path: 'alertas', loadComponent: () => import('./admin/alerts/alerts').then((m) => m.Alerts) },
      { path: 'sugerencias', loadComponent: () => import('./admin/feedback/feedback').then((m) => m.Feedback) },
      {
        path: 'asistente',
        loadComponent: () => import('./admin/assistant-faq/assistant-faq').then((m) => m.AssistantFaq),
      },
      { path: 'estadisticas', loadComponent: () => import('./admin/stats/stats').then((m) => m.Stats) },
      { path: 'usuarios', loadComponent: () => import('./admin/users/users').then((m) => m.Users) },
      {
        path: 'administradores',
        canActivate: [principalOnly],
        loadComponent: () => import('./admin/team/team').then((m) => m.Team),
      },
      {
        path: 'premium',
        canActivate: [principalOnly],
        loadComponent: () => import('./admin/premium/premium').then((m) => m.Premium),
      },
      { path: 'perfil', loadComponent: () => import('./shared/profile/profile').then((m) => m.Profile) },
    ],
  },
  {
    path: '',
    component: SiteShell,
    children: [
      { path: '', pathMatch: 'full', component: About, canActivate: [panelFirst] },
      {
        matcher: mapMatcher,
        canActivate: [lineNeedsSession],
        loadComponent: () => import('./site/home/home').then((m) => m.Home),
      },
      // El enlace que manda la app al compartir un viaje en vivo. No pide sesión.
      { path: 'viaje/:id', loadComponent: () => import('./site/trip/trip').then((m) => m.Trip) },
      { path: 'descargar', loadComponent: () => import('./site/download/download').then((m) => m.Download) },
      {
        path: 'privacidad',
        data: { page: 'privacy' },
        loadComponent: () => import('./site/legal/legal').then((m) => m.Legal),
      },
      {
        path: 'terminos',
        data: { page: 'terms' },
        loadComponent: () => import('./site/legal/legal').then((m) => m.Legal),
      },
      { path: 'contacto', loadComponent: () => import('./site/contact/contact').then((m) => m.Contact) },
      {
        path: 'perfil',
        canActivate: [signedIn],
        data: { centered: true },
        loadComponent: () => import('./shared/profile/profile').then((m) => m.Profile),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
