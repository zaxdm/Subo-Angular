import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';

import { Store } from '../../core/store';
import { SuboMark } from '../../shared/subo-mark/subo-mark';

/** Una sección del panel y su dirección. */
interface Section {
  label: string;
  icon: string;
  path: string;

  /** Cuántas cosas esperan revisión ahí; 0 no se muestra. */
  badge?: number;
}

/** Secciones que van juntas en la barra lateral, bajo un rótulo. */
interface Group {
  title: string;
  sections: Section[];
}

/**
 * El marco del panel de administración: la barra lateral oscura con las
 * secciones agrupadas y la cuenta abajo, y una cabecera con dónde se está. En
 * pantallas estrechas la barra lateral se abre como un cajón desde el menú.
 */
@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive, SuboMark],
  selector: 'app-admin-shell',
  styleUrl: './admin-shell.css',
  templateUrl: './admin-shell.html',
})
export class AdminShell {
  protected readonly store = inject(Store);
  private readonly router = inject(Router);

  protected readonly menuOpen = signal(false);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  /** Las rutas que alguien grabó y esperan que un administrador las publique. */
  private readonly pending = computed(() => this.store.routes().filter((route) => route.status === 'PENDING').length);

  /** Las secciones a las que esta cuenta puede ir. */
  protected readonly groups = computed<Group[]>(() => [
    {
      title: 'General',
      sections: [
        { label: 'Estadísticas', icon: 'insights', path: '/panel/estadisticas' },
        // El dinero lo ve solo el principal, como los pagos de Premium.
        ...(this.store.session()?.isSuperAdmin
          ? [{ label: 'Finanzas', icon: 'account_balance_wallet', path: '/panel/finanzas' }]
          : []),
      ],
    },
    {
      title: 'Contenido',
      sections: [
        { label: 'Rutas y micros', icon: 'directions_bus', path: '/panel', badge: this.pending() },
        { label: 'Alertas', icon: 'campaign', path: '/panel/alertas' },
        { label: 'Sugerencias', icon: 'forum', path: '/panel/sugerencias' },
        { label: 'Asistente', icon: 'chat_bubble_outline', path: '/panel/asistente' },
      ],
    },
    {
      title: 'Comunidad',
      sections: [
        { label: 'Usuarios', icon: 'group', path: '/panel/usuarios' },
        // Quién más es administrador lo decide solo el principal.
        ...(this.store.session()?.isSuperAdmin
          ? [
              { label: 'Premium', icon: 'workspace_premium', path: '/panel/premium' },
              { label: 'Administradores', icon: 'admin_panel_settings', path: '/panel/administradores' },
            ]
          : []),
      ],
    },
    {
      title: 'Cuenta',
      sections: [{ label: 'Mi perfil', icon: 'person', path: '/panel/perfil' }],
    },
  ]);

  /** El nombre de la sección abierta, para la cabecera. */
  protected readonly current = computed(() => {
    const path = this.url().split(/[?#]/)[0].replace(/\/$/, '') || '/panel';
    const sections = this.groups().flatMap((group) => group.sections);
    return sections.find((section) => section.path === path)?.label ?? 'Rutas y micros';
  });

  protected readonly initial = computed(() => (this.store.session()?.name || '?').trim().charAt(0).toUpperCase());
}
