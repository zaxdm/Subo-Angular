import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { BusRoute, ROUTE_STATUSES, RouteStatus, copyRoute, newRoute, routeStatusLabel, safeUrl } from '../../core/models';
import { duplicateRoute } from '../../core/route-tools';
import { Store } from '../../core/store';
import { RoutePhoto } from '../../shared/route-photo/route-photo';
import { Editor } from '../editor/editor';

/**
 * El catálogo: cuántas rutas hay, un buscador con filtro por estado y una
 * tarjeta por ruta. Con una ruta abierta, en su lugar se ve el editor.
 */
@Component({
  imports: [FormsModule, RoutePhoto, Editor],
  selector: 'app-catalog',
  styleUrl: './catalog.css',
  templateUrl: './catalog.html',
})
export class Catalog {
  protected readonly store = inject(Store);

  protected readonly statuses = ROUTE_STATUSES;
  protected readonly statusLabel = routeStatusLabel;
  protected readonly safeUrl = safeUrl;

  protected readonly search = signal('');

  /** Vacío: todos los estados. */
  protected readonly status = signal<RouteStatus | ''>('');
  protected readonly refreshing = signal(false);

  /** La tarjeta que tiene desplegado el menú de copiar. */
  protected readonly copying = signal<BusRoute | null>(null);

  protected readonly published = computed(
    () => this.store.routes().filter((route) => route.status === 'APPROVED').length,
  );
  protected readonly withPhoto = computed(
    () => this.store.routes().filter((route) => safeUrl(route.imageUrl) !== null).length,
  );

  protected readonly visible = computed(() => {
    const query = this.search().trim().toLowerCase();
    const status = this.status();
    return this.store.routes().filter((route) => {
      if (status !== '' && route.status !== status) return false;
      return [route.name, route.vehicleName, route.origin, route.destination, route.letter]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  });

  protected async refresh(): Promise<void> {
    this.refreshing.set(true);
    await this.store.refresh();
    this.refreshing.set(false);
  }

  protected create(): void {
    this.store.editing.set(newRoute());
  }

  protected edit(route: BusRoute): void {
    this.store.editing.set(copyRoute(route));
  }

  /** Una copia no tiene `id`: el editor la abre como ruta nueva. */
  protected duplicate(route: BusRoute, reversed: boolean): void {
    this.copying.set(null);
    this.store.editing.set(duplicateRoute(route, reversed));
  }
}
