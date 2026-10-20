import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  BusRoute,
  ROUTE_STATUSES,
  RouteStatus,
  copyRoute,
  newRoute,
  routeStatusLabel,
  safeUrl,
} from '../../core/models';
import { groupServices } from '../../core/directions';
import { duplicateRoute } from '../../core/route-tools';
import { Store } from '../../core/store';
import { RoutePhoto } from '../../shared/route-photo/route-photo';
import { Editor } from '../editor/editor';

/**
 * El catálogo: cuántas líneas hay, un buscador con filtro por estado y una
 * tarjeta por línea (empresa y letra) con su ida y su vuelta dentro. Con una
 * ruta abierta, en su lugar se ve el editor.
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

  /** Cuántos recorridos hay en cada estado, para los filtros. */
  protected readonly statusCounts = computed(() => {
    const counts: Record<string, number> = { '': this.store.routes().length };
    for (const route of this.store.routes()) counts[route.status] = (counts[route.status] ?? 0) + 1;
    return counts;
  });

  /** Solo las rutas que repiten el recorrido de otra de su línea. */
  protected readonly onlyDuplicates = signal(false);

  /** Las rutas agrupadas por línea, con su sentido y si repiten a otra. */
  protected readonly services = computed(() => groupServices(this.store.routes()));

  /** Las repetidas que aún se ven o esperan revisión: las ocultas ya están atendidas. */
  protected readonly duplicates = computed(
    () =>
      this.services()
        .flatMap((line) => line.routes)
        .filter((item) => item.duplicateOf !== null && item.route.status !== 'REJECTED').length,
  );

  protected readonly visible = computed(() => {
    const query = this.search().trim().toLowerCase();
    const status = this.status();
    const duplicates = this.onlyDuplicates();
    return this.services()
      .map((line) => ({
        ...line,
        routes: line.routes.filter(({ route, duplicateOf }) => {
          if (status !== '' && route.status !== status) return false;
          if (duplicates && duplicateOf === null) return false;
          return [route.name, route.vehicleName, route.origin, route.destination, route.letter]
            .join(' ')
            .toLowerCase()
            .includes(query);
        }),
      }))
      .filter((line) => line.routes.length > 0);
  });

  /** La foto de la línea: la primera de sus rutas que tenga una. */
  protected photoOf(routes: { route: BusRoute }[]): string | null {
    return routes.map(({ route }) => safeUrl(route.imageUrl)).find((url) => url !== null) ?? null;
  }

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
