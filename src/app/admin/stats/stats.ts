import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Api } from '../../core/api';
import { Compared, Dashboard, PremiumPayment, formatSoles } from '../../core/models';
import { Store } from '../../core/store';
import { PageFrame } from '../../shared/page-frame/page-frame';
import { DayChart, DayPoint, DaySeries, shortDay } from '../day-chart/day-chart';

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
  if (previous === 0) return { text: value > 0 ? 'nuevo' : 'sin cambios', up: value > 0 ? true : null };
  const percent = Math.round(((value - previous) / previous) * 100);
  if (percent === 0) return { text: 'igual', up: null };
  return { text: `${percent > 0 ? '+' : ''}${percent} %`, up: percent > 0 };
}

export const PERIODS = [7, 30, 90] as const;

/** El día de un momento en hora de Perú, como "2026-10-19", igual que los días del tablero. */
const limaDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Lima',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** "2026-10-19" movido tantos días como se diga, hacia atrás si es negativo. */
function shiftDay(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

/** Suma en soles, sin los restos de coma flotante. */
const total = (payments: { amount: number }[]): number =>
  Math.round(payments.reduce((sum, payment) => sum + payment.amount, 0) * 100) / 100;

/**
 * El tablero del panel, solo con lo principal: quién entra (Android o web),
 * cuántos se registran y descargan la app, cuánto se reporta, el dinero de
 * Premium y qué rutas se miran, en un periodo comparado con el anterior.
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

  protected readonly formatSoles = formatSoles;

  /** El dinero solo lo ve el administrador principal, como Premium y Finanzas. */
  protected readonly principal = computed(() => this.store.session()?.isSuperAdmin ?? false);

  /** Los comprobantes de Premium; `null` si no se pidieron o no llegaron. */
  protected readonly payments = signal<PremiumPayment[] | null>(null);

  protected readonly visitorSeries: DaySeries[] = [
    { key: 'android', label: 'App Android', color: 'var(--chart-1)' },
    { key: 'web', label: 'Web', color: 'var(--chart-2)' },
  ];
  protected readonly revenueSeries: DaySeries[] = [
    { key: 'newcomers', label: 'Premium nuevos', color: 'var(--chart-1)' },
    { key: 'renewals', label: 'Renovaciones', color: 'var(--chart-2)' },
  ];

  protected readonly points = computed<DayPoint[]>(() => (this.data()?.series ?? []) as unknown as DayPoint[]);

  protected readonly metrics = computed(() => {
    const data = this.data();
    const totals = data?.totals;
    if (!data || !totals) return [];
    // Las visitas y descargas se cuentan desde hace poco: si el periodo
    // anterior no tiene registro, compararlo engañaría.
    const fresh = data.trackingSince === null || data.trackingSince > (data.series[0]?.day ?? '');
    const tracked = (compared: Compared) => (fresh ? { text: 'sin comparar', up: null } : change(compared));
    return [
      {
        label: 'Visitantes al día',
        icon: 'visibility',
        tone: 'blue',
        hint: 'Personas distintas por día, de media',
        value: totals.dailyVisitors.value,
        change: tracked(totals.dailyVisitors),
      },
      {
        label: 'Cuentas nuevas',
        icon: 'person_add',
        tone: 'yellow',
        hint: 'Registros en el periodo',
        value: totals.newUsers.value,
        change: change(totals.newUsers),
      },
      {
        label: 'Descargas de la app',
        icon: 'download',
        tone: 'orange',
        hint: 'Clics en «Descargar» de la web',
        value: totals.downloads.value,
        change: tracked(totals.downloads),
      },
      {
        label: 'Alertas publicadas',
        icon: 'campaign',
        tone: 'red',
        hint: 'Reportes de la calle',
        value: totals.alerts.value,
        change: change(totals.alerts),
      },
    ];
  });

  /** Lo que no cambia con el periodo: cómo está la app hoy. */
  protected readonly today = computed(() => {
    const totals = this.data()?.totals;
    if (!totals) return [];
    return [
      { label: 'Cuentas en total', icon: 'group', value: totals.users, link: '/panel/usuarios' },
      { label: 'Premium activos', icon: 'workspace_premium', value: totals.premium, link: null },
      { label: 'Rutas por aprobar', icon: 'pending_actions', value: totals.pendingRoutes, link: '/panel' },
      { label: 'Sugerencias nuevas', icon: 'forum', value: totals.newFeedback, link: '/panel/sugerencias' },
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

  protected readonly topRoutes = computed(() =>
    bars(
      (this.data()?.topRoutes ?? []).map((route) => ({ label: `${route.letter} · ${route.name}`, value: route.views })),
    ),
  );

  /**
   * El dinero que entra por Premium en el periodo: los pagos por Yape ya
   * confirmados, contados el día en que se subió el comprobante. Un pago es de
   * alguien nuevo si es el primero que se le confirmó; si no, es una renovación.
   */
  protected readonly revenue = computed(() => {
    const payments = this.payments();
    const series = this.data()?.series ?? [];
    if (payments === null || series.length === 0) return null;

    const first = series[0].day;
    const last = series[series.length - 1].day;
    const previousFirst = shiftDay(first, -series.length);

    const approved = payments
      .filter((payment) => payment.status === 'APPROVED')
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const seen = new Set<string>();
    const marked = approved.map((payment) => {
      const who = payment.userEmail || payment.id;
      const newcomer = !seen.has(who);
      seen.add(who);
      return { ...payment, day: limaDay.format(payment.createdAt), newcomer };
    });
    const current = marked.filter((payment) => payment.day >= first && payment.day <= last);
    const previous = marked.filter((payment) => payment.day >= previousFirst && payment.day < first);

    const income = { value: total(current), previous: total(previous) };
    const newcomers = {
      value: current.filter((payment) => payment.newcomer).length,
      previous: previous.filter((payment) => payment.newcomer).length,
    };

    const metrics = [
      {
        label: 'Dinero que entró',
        icon: 'payments',
        tone: 'green',
        hint: 'Pagos de Premium confirmados',
        value: formatSoles(income.value),
        change: change(income),
      },
      {
        label: 'Premium nuevos',
        icon: 'workspace_premium',
        tone: 'yellow',
        hint: 'Cuentas que pagaron por primera vez',
        value: String(newcomers.value),
        change: change(newcomers),
      },
    ];

    const byDay = new Map<string, { newcomers: number; renewals: number }>();
    for (const payment of current) {
      const entry = byDay.get(payment.day) ?? { newcomers: 0, renewals: 0 };
      if (payment.newcomer) entry.newcomers += payment.amount;
      else entry.renewals += payment.amount;
      byDay.set(payment.day, entry);
    }
    const round = (value: number) => Math.round(value * 100) / 100;
    const points: DayPoint[] = series.map((point) => ({
      day: point.day,
      newcomers: round(byDay.get(point.day)?.newcomers ?? 0),
      renewals: round(byDay.get(point.day)?.renewals ?? 0),
    }));

    const pending = payments.filter((payment) => payment.status === 'PENDING');
    return {
      metrics,
      points,
      pending: { count: pending.length, amount: total(pending) },
    };
  });

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
      const [data] = await Promise.all([this.api.dashboard(this.days()), this.loadPayments()]);
      this.data.set(data);
      this.failed.set(false);
    } catch (error) {
      this.failed.set(this.data() === null);
      this.store.onError(error);
    } finally {
      this.loading.set(false);
    }
  }

  /** Los pagos no dependen del periodo, pero se piden de nuevo al refrescar. Si fallan, el resto se ve igual. */
  private async loadPayments(): Promise<void> {
    if (!this.principal()) return;
    try {
      this.payments.set(await this.api.premiumPayments());
    } catch {
      this.payments.set(null);
    }
  }
}
