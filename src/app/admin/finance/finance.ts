import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { Api } from '../../core/api';
import { FinanceEntry, FinanceEntryDraft, FinanceKind, FinanceSummary, formatSoles } from '../../core/models';
import { Store } from '../../core/store';
import { Ui } from '../../core/ui';
import { PageFrame } from '../../shared/page-frame/page-frame';

/** Los periodos que da el servidor, en meses hasta el actual. */
const PERIODS = [
  { months: 1, label: 'Este mes' },
  { months: 3, label: '3 meses' },
  { months: 6, label: '6 meses' },
  { months: 12, label: '12 meses' },
];

/** En qué se gasta; lo técnico va aparte para ver cuánto cuesta tener Subo en marcha. */
const EXPENSE_CATEGORIES = [
  { id: 'tecnologia', label: 'Servidor, IA y dominio' },
  { id: 'publicidad', label: 'Publicidad' },
  { id: 'personal', label: 'Personal' },
  { id: 'operacion', label: 'Operación' },
  { id: 'impuestos', label: 'Impuestos y comisiones' },
  { id: 'otros', label: 'Otros' },
];

/** De dónde entra dinero además de Yape, que se cuenta solo. */
const INCOME_CATEGORIES = [
  { id: 'premium', label: 'Premium cobrado aparte' },
  { id: 'publicidad', label: 'Publicidad' },
  { id: 'convenios', label: 'Convenios' },
  { id: 'otros', label: 'Otros' },
];

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "oct 2026". */
const monthLabel = (month: string): string => {
  const [year, number] = month.split('-').map(Number);
  return `${MONTHS[number - 1] ?? ''} ${year}`;
};

/** Hoy en la hora de quien mira, como "2026-10-22". */
const today = (): string => {
  const now = new Date();
  const two = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
};

/**
 * Finanzas: lo que entra y lo que sale cada mes, y lo que queda.
 *
 * Solo la ve el administrador principal. Los pagos de Premium por Yape que se
 * confirman en Premium cuentan solos; los gastos (servidor, publicidad…) y
 * cualquier otro ingreso se anotan aquí, sueltos o cada mes.
 */
@Component({
  imports: [FormsModule, PageFrame],
  selector: 'app-finance',
  styleUrl: './finance.css',
  templateUrl: './finance.html',
})
export class Finance {
  private readonly api = inject(Api);
  private readonly store = inject(Store);
  private readonly ui = inject(Ui);

  protected readonly periods = PERIODS;
  protected readonly formatSoles = formatSoles;
  protected readonly monthLabel = monthLabel;

  protected readonly months = signal(6);
  /** `null` mientras llega la primera respuesta. */
  protected readonly data = signal<FinanceSummary | null>(null);
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);

  // --- El movimiento que se está anotando o corrigiendo ---

  /** El movimiento que se corrige; `null` si se anota uno nuevo. */
  protected readonly editing = signal<string | null>(null);
  protected readonly kind = signal<FinanceKind>('EXPENSE');
  protected readonly concept = signal('');
  protected readonly category = signal('tecnologia');
  protected readonly amount = signal('');
  protected readonly day = signal(today());
  protected readonly monthly = signal(false);
  protected readonly endMonth = signal('');
  protected readonly note = signal('');
  protected readonly saving = signal(false);
  protected readonly problem = signal<string | null>(null);

  protected readonly categories = computed(() => (this.kind() === 'INCOME' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES));

  /** Las cuatro cifras de arriba. */
  protected readonly metrics = computed(() => {
    const data = this.data();
    if (data === null) return [];
    const margin = data.income > 0 ? Math.round((data.profit / data.income) * 100) : null;
    return [
      {
        label: 'Ingresos',
        value: formatSoles(data.income),
        hint: `${formatSoles(data.yape)} por Yape · ${data.yapePayments} ${data.yapePayments === 1 ? 'pago' : 'pagos'}`,
        icon: 'payments',
        tone: 'green',
      },
      {
        label: 'Costos',
        value: formatSoles(data.costs),
        hint: 'Gastos anotados del periodo',
        icon: 'receipt_long',
        tone: 'orange',
      },
      {
        label: data.profit < 0 ? 'Pérdida' : 'Ganancia',
        value: formatSoles(data.profit),
        hint: 'Ingresos menos costos',
        icon: data.profit < 0 ? 'trending_down' : 'trending_up',
        tone: data.profit < 0 ? 'red' : 'blue',
      },
      {
        label: 'Margen',
        value: margin === null ? '—' : `${margin} %`,
        hint: 'Lo que queda de cada sol que entra',
        icon: 'percent',
        tone: 'gray',
      },
    ];
  });

  /** Cada mes con el largo de sus barras, sobre el mayor de todos. */
  protected readonly bars = computed(() => {
    const months = this.data()?.months ?? [];
    const top = Math.max(1, ...months.map((month) => Math.max(month.income, month.costs)));
    return months.map((month) => ({
      ...month,
      label: monthLabel(month.month),
      incomeWidth: (month.income / top) * 100,
      costsWidth: (month.costs / top) * 100,
    }));
  });

  protected readonly costsByCategory = computed(() => this.withLabels(this.data()?.costsByCategory ?? [], 'EXPENSE'));
  protected readonly incomeByCategory = computed(() => this.withLabels(this.data()?.incomeByCategory ?? [], 'INCOME'));

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.data.set(await this.api.finance(this.months()));
      this.failed.set(false);
    } catch (error) {
      this.failed.set(true);
      this.store.onError(error);
    } finally {
      this.loading.set(false);
    }
  }

  protected choose(months: number): void {
    if (months === this.months()) return;
    this.months.set(months);
    void this.load();
  }

  protected categoryLabel(kind: FinanceKind, id: string): string {
    if (id === 'yape') return 'Premium por Yape';
    const list = kind === 'INCOME' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    return list.find((item) => item.id === id)?.label ?? 'Otros';
  }

  /** Cuándo cuenta un movimiento: su día o, si es mensual, desde qué mes y hasta cuál. */
  protected when(entry: FinanceEntry): string {
    if (!entry.monthly) {
      const [year, month, date] = entry.day.split('-');
      return `${date}/${month}/${year}`;
    }
    const from = monthLabel(entry.day.slice(0, 7));
    return entry.endMonth === null ? `Cada mes desde ${from}` : `Cada mes, de ${from} a ${monthLabel(entry.endMonth)}`;
  }

  protected setKind(kind: FinanceKind): void {
    this.kind.set(kind);
    if (!this.categories().some((item) => item.id === this.category())) this.category.set(this.categories()[0].id);
  }

  protected edit(entry: FinanceEntry): void {
    this.editing.set(entry.id);
    this.kind.set(entry.kind);
    this.concept.set(entry.concept);
    this.category.set(entry.category);
    this.amount.set(String(entry.amount));
    this.day.set(entry.day);
    this.monthly.set(entry.monthly);
    this.endMonth.set(entry.endMonth ?? '');
    this.note.set(entry.note);
    this.problem.set(null);
  }

  protected reset(): void {
    this.editing.set(null);
    this.concept.set('');
    this.amount.set('');
    this.day.set(today());
    this.monthly.set(false);
    this.endMonth.set('');
    this.note.set('');
    this.problem.set(null);
  }

  protected async save(): Promise<void> {
    if (this.saving()) return;
    const amount = Number(this.amount().replace(',', '.'));
    if (this.concept().trim() === '') {
      this.problem.set('Escribe el concepto');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      this.problem.set('Escribe un monto mayor que cero');
      return;
    }
    const draft: FinanceEntryDraft = {
      kind: this.kind(),
      concept: this.concept().trim(),
      category: this.category(),
      amount,
      day: this.day(),
      monthly: this.monthly(),
      endMonth: this.monthly() && this.endMonth() !== '' ? this.endMonth() : null,
      note: this.note().trim(),
    };
    this.problem.set(null);
    this.saving.set(true);
    try {
      await this.api.saveFinanceEntry(this.editing(), draft);
      this.ui.notify(this.editing() === null ? 'Movimiento anotado.' : 'Movimiento corregido.');
      this.reset();
      await this.load();
    } catch (error) {
      this.store.onError(error);
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(entry: FinanceEntry): Promise<void> {
    const confirmed = await this.ui.confirm({
      title: 'Borrar el movimiento',
      message: `«${entry.concept}» (${formatSoles(entry.amount)}) dejará de contar en las cuentas.`,
      action: 'Borrar',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await this.api.deleteFinanceEntry(entry.id);
      if (this.editing() === entry.id) this.reset();
      await this.load();
    } catch (error) {
      this.store.onError(error);
    }
  }

  private withLabels(rows: { category: string; amount: number }[], kind: FinanceKind) {
    const total = rows.reduce((sum, row) => sum + row.amount, 0) || 1;
    return rows.map((row) => ({
      ...row,
      label: this.categoryLabel(kind, row.category),
      share: Math.round((row.amount / total) * 100),
    }));
  }
}
