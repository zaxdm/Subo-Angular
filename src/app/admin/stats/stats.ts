import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Api } from '../../core/api';
import { Compared, Dashboard, alertLabel } from '../../core/models';
import { Store } from '../../core/store';
import { PageFrame } from '../../shared/page-frame/page-frame';
import { DayChart, DayPoint, DaySeries, shortDay } from '../day-chart/day-chart';
import { lastSeenLabel } from '../users/users';

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

/** Cómo cambió un número frente al periodo anterior, dicho en corto. */
function change(compared: Compared): { text: string; up: boolean | null } {
  const { value, previous } = compared;
  if (previous === 0) return { text: value > 0 ? 'nuevo en este periodo' : 'sin cambios', up: value > 0 ? true : null };
  const percent = Math.round(((value - previous) / previous) * 100);
  if (percent === 0) return { text: 'igual que antes', up: null };
  return { text: `${percent > 0 ? '+' : ''}${percent} % vs. periodo anterior`, up: percent > 0 };
}

const DEVICES: Record<string, string> = { android: 'Android', ios: 'iPhone', computadora: 'Computadora' };

export const PERIODS = [7, 30, 90] as const;

/**
 * El tablero del panel: quién entra (Android o web), cuántos se registran y
 * descargan la app, qué se reporta y qué rutas se miran, en un periodo
 * comparado con el anterior.
 */
@Component({
  imports: [PageFrame, DayChart, RouterLink],
  selector: 'app-stats',
  styleUrl: './stats.css',
  templateUrl: './stats.html',
})
export class Stats {
  private readonly api = inject(Api);
  private readonly store = inject(Store);

  protected readonly periods = PERIODS;
  protected readonly days = signal<number>(30);

  /** `null` mientras llega la primera respuesta, o si falló. */
  protected readonly data = signal<Dashboard | null>(null);
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);

  protected readonly lastSeen = lastSeenLabel;

  protected readonly visitorSeries: DaySeries[] = [
    { key: 'android', label: 'App Android', color: 'var(--chart-1)' },
    { key: 'web', label: 'Web', color: 'var(--chart-2)' },
  ];
  protected readonly signupSeries: DaySeries[] = [
    { key: 'newUsers', label: 'Cuentas nuevas', color: 'var(--chart-1)' },
  ];
  protected readonly downloadSeries: DaySeries[] = [{ key: 'downloads', label: 'Descargas', color: 'var(--chart-1)' }];
  protected readonly alertSeries: DaySeries[] = [{ key: 'alerts', label: 'Alertas', color: 'var(--chart-1)' }];

  protected readonly points = computed<DayPoint[]>(() => (this.data()?.series ?? []) as unknown as DayPoint[]);

  protected readonly metrics = computed(() => {
    const totals = this.data()?.totals;
    if (!totals) return [];
    return [
      {
        label: 'Visitantes al día',
        hint: 'Personas distintas por día, de media',
        value: totals.dailyVisitors.value,
        change: change(totals.dailyVisitors),
      },
      {
        label: 'Cuentas activas',
        hint: 'Cuentas que entraron en el periodo',
        value: totals.activeAccounts.value,
        change: change(totals.activeAccounts),
      },
      {
        label: 'Cuentas nuevas',
        hint: 'Registros en el periodo',
        value: totals.newUsers.value,
        change: change(totals.newUsers),
      },
      {
        label: 'Descargas de la app',
        hint: 'Clics en «Descargar» de la web',
        value: totals.downloads.value,
        change: change(totals.downloads),
      },
      {
        label: 'Alertas publicadas',
        hint: 'Reportes de la calle',
        value: totals.alerts.value,
        change: change(totals.alerts),
      },
      {
        label: 'Preguntas al asistente',
        hint: 'Consultas a «Subo»',
        value: totals.assistantQuestions.value,
        change: change(totals.assistantQuestions),
      },
    ];
  });

  /** Lo que no cambia con el periodo: cómo está la app hoy. */
  protected readonly today = computed(() => {
    const totals = this.data()?.totals;
    if (!totals) return [];
    return [
      { label: 'Visitantes hoy', value: totals.visitorsToday, link: null },
      { label: 'Cuentas en total', value: totals.users, link: '/panel/usuarios' },
      { label: 'Premium activos', value: totals.premium, link: null },
      { label: 'Rutas publicadas', value: totals.publishedRoutes, link: '/panel' },
      { label: 'Rutas por aprobar', value: totals.pendingRoutes, link: '/panel' },
      { label: 'Sugerencias nuevas', value: totals.newFeedback, link: '/panel/sugerencias' },
      { label: 'Calificaciones', value: totals.ratings, link: null },
    ];
  });

  /** Qué parte de las visitas llega desde la app y qué parte desde la web. */
  protected readonly platformShare = computed(() => {
    const platforms = this.data()?.platforms;
    const total = (platforms?.android ?? 0) + (platforms?.web ?? 0);
    if (!platforms || total === 0) return null;
    const android = Math.round((100 * platforms.android) / total);
    return { android, web: 100 - android };
  });

  protected readonly devices = computed(() =>
    bars(
      Object.entries(this.data()?.downloadsByDevice ?? {})
        .sort((a, b) => b[1] - a[1])
        .map(([device, value]) => ({ label: DEVICES[device] ?? device, value })),
    ),
  );

  protected readonly topRoutes = computed(() =>
    bars(
      (this.data()?.topRoutes ?? []).map((route) => ({ label: `${route.letter} · ${route.name}`, value: route.views })),
    ),
  );

  protected readonly byType = computed(() =>
    bars(
      Object.entries(this.data()?.alertsByType ?? {})
        .sort((a, b) => b[1] - a[1])
        .map(([type, value]) => ({ label: alertLabel(type, type), value })),
    ),
  );

  /** Las 24 horas del día como columnas: cuanto más alta, más alertas a esa hora. */
  protected readonly hours = computed(() =>
    bars((this.data()?.alertsByHour ?? []).map((value, hour) => ({ label: String(hour), value }))),
  );

  protected readonly anyHour = computed(() => this.hours().some((hour) => hour.value > 0));

  /** Aviso de desde cuándo hay registro de visitas, si empieza dentro del periodo. */
  protected readonly trackingNote = computed(() => {
    const data = this.data();
    if (!data) return null;
    if (data.trackingSince === null)
      return 'Las visitas y descargas se cuentan desde hoy: los gráficos se irán llenando.';
    const start = data.series[0]?.day ?? '';
    return data.trackingSince > start
      ? `Las visitas y descargas se cuentan desde el ${shortDay(data.trackingSince)}; antes no hay registro.`
      : null;
  });

  constructor() {
    void this.load();
  }

  protected choose(days: number): void {
    if (days === this.days()) return;
    this.days.set(days);
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.data.set(await this.api.dashboard(this.days()));
      this.failed.set(false);
    } catch (error) {
      this.failed.set(this.data() === null);
      this.store.onError(error);
    } finally {
      this.loading.set(false);
    }
  }
}
