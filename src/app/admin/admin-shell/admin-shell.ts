import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { Store } from '../../core/store';
import { SuboMark } from '../../shared/subo-mark/subo-mark';

/** Una sección del panel y su dirección. */
interface Section {
  label: string;
  icon: string;
  path: string;
}

/**
 * El marco del panel de administración: la barra lateral de la marca con las
 * secciones y la cabecera con la cuenta. En pantallas estrechas la barra
 * lateral se queda en una franja arriba.
 */
@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive, SuboMark],
  selector: 'app-admin-shell',
  styleUrl: './admin-shell.css',
  templateUrl: './admin-shell.html',
})
export class AdminShell {
  protected readonly store = inject(Store);

  /** Las secciones a las que esta cuenta puede ir. */
  protected readonly sections = computed<Section[]>(() => [
    { label: 'Rutas y micros', icon: 'north_east', path: '/panel' },
    { label: 'Alertas', icon: 'report', path: '/panel/alertas' },
    { label: 'Sugerencias', icon: 'mail', path: '/panel/sugerencias' },
    { label: 'Estadísticas', icon: 'insights', path: '/panel/estadisticas' },
    // Quién más es administrador lo decide solo el principal.
    ...(this.store.session()?.isSuperAdmin
      ? [
          { label: 'Administradores', icon: 'admin_panel_settings', path: '/panel/administradores' },
          { label: 'Premium', icon: 'workspace_premium', path: '/panel/premium' },
        ]
      : []),
    { label: 'Mi perfil', icon: 'person', path: '/panel/perfil' },
  ]);
}
