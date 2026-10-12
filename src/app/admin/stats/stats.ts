import { Component, computed, inject, signal } from '@angular/core';

import { Api } from '../../core/api';
import { Stats as UsageStats, alertLabel } from '../../core/models';
import { Store } from '../../core/store';
import { PageFrame } from '../../shared/page-frame/page-frame';

/** Una barra horizontal con su etiqueta y su número. */
interface Bar {
  label: string;
  value: number;

  /** Cuánto mide frente a la más larga, en tanto por ciento. */
  percent: number;
}

function bars(entries: { label: string; value: number }[]): Bar[] {
  const max = Math.max(0, ...entries.map((entry) => entry.value));
  return entries.map((entry) => ({ ...entry, percent: max > 0 ? (100 * entry.value) / max : 0 }));
}

/**
 * Cómo se está usando Subo: cuánta gente hay, qué se reporta y cuándo, y qué
 * rutas se miran más.
 */
@Component({
  imports: [PageFrame],
  selector: 'app-stats',
  styleUrl: './stats.css',
  templateUrl: './stats.html',
})
export class Stats {
  private readonly api = inject(Api);
  private readonly store = inject(Store);

  /** `null` mientras llega la primera respuesta, o si falló. */
  protected readonly stats = signal<UsageStats | null>(null);
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);

  protected readonly metrics = computed(() => {
    const stats = this.stats();
    if (stats === null) return [];
    return [
      { label: 'Cuentas', value: stats.users, note: `+${stats.newUsersThisWeek} esta semana` },
      { label: 'Alertas vigentes', value: stats.activeAlerts, note: '' },
      { label: 'Calificaciones', value: stats.ratings, note: '' },
      { label: 'Rutas por aprobar', value: stats.pendingRoutes, note: '' },
      { label: 'Sugerencias nuevas', value: stats.newFeedback, note: '' },
    ];
  });

  protected readonly topRoutes = computed(() =>
    bars((this.stats()?.topRoutes ?? []).map((route) => ({ label: `${route.letter} · ${route.name}`, value: route.views }))),
  );

  protected readonly byType = computed(() =>
    bars(
      Object.entries(this.stats()?.alertsThisWeek ?? {})
        .sort((a, b) => b[1] - a[1])
        .map(([type, value]) => ({ label: alertLabel(type, type), value })),
    ),
  );

  /** Las 24 horas del día como columnas: cuanto más alta, más alertas a esa hora. */
  protected readonly hours = computed(() =>
    bars((this.stats()?.alertsByHour ?? []).map((value, hour) => ({ label: String(hour), value }))),
  );

  protected readonly anyHour = computed(() => this.hours().some((hour) => hour.value > 0));

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.stats.set(await this.api.stats());
      this.failed.set(false);
    } catch (error) {
      this.failed.set(this.stats() === null);
      this.store.onError(error);
    } finally {
      this.loading.set(false);
    }
  }
}
