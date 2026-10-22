import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { Api } from '../../core/api';
import { FinanceEntry, FinanceSummary, formatSoles } from '../../core/models';
import { Store } from '../../core/store';
import { Ui } from '../../core/ui';
import { Finance } from './finance';

describe('Finance', () => {
  let fixture: ComponentFixture<Finance>;
  let page: HTMLElement;
  const servidor: FinanceEntry = {
    id: 'm1',
    kind: 'EXPENSE',
    concept: 'Supabase',
    category: 'tecnologia',
    amount: 25,
    day: '2026-09-01',
    monthly: true,
    endMonth: null,
    note: '',
  };
  const summary: FinanceSummary = {
    months: [
      { month: '2026-09', income: 9.9, yape: 9.9, costs: 25, profit: -15.1 },
      { month: '2026-10', income: 84.9, yape: 34.9, costs: 80.5, profit: 4.4 },
    ],
    income: 94.8,
    yape: 44.8,
    yapePayments: 3,
    costs: 105.5,
    profit: -10.7,
    costsByCategory: [{ category: 'tecnologia', amount: 105.5 }],
    incomeByCategory: [
      { category: 'publicidad', amount: 50 },
      { category: 'yape', amount: 44.8 },
    ],
    entries: [servidor],
  };
  const api = { finance: vi.fn(), saveFinanceEntry: vi.fn(), deleteFinanceEntry: vi.fn() };
  const store = { onError: vi.fn() };
  const ui = { notify: vi.fn(), confirm: vi.fn() };

  const text = () => page.textContent?.replace(/\s+/g, ' ') ?? '';
  const click = async (label: string) => {
    const button = Array.from(page.querySelectorAll('button')).find((item) => item.textContent?.trim() === label);
    expect(button, `Botón ${label}`).toBeDefined();
    button!.click();
    await fixture.whenStable();
  };
  const fill = (selector: string, value: string) => {
    const field = page.querySelector<HTMLInputElement>(selector)!;
    field.value = value;
    field.dispatchEvent(new Event('input'));
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    api.finance.mockResolvedValue(summary);
    api.saveFinanceEntry.mockResolvedValue(servidor);
    await TestBed.configureTestingModule({
      imports: [Finance],
      providers: [
        { provide: Api, useValue: api },
        { provide: Store, useValue: store },
        { provide: Ui, useValue: ui },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Finance);
    page = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  it('escribe los soles como en Perú y marca lo negativo', () => {
    expect(formatSoles(1234.5)).toBe('S/ 1,234.50');
    expect(formatSoles(-10.7)).toBe('−S/ 10.70');
  });

  it('enseña ingresos, costos, pérdida y el detalle por mes y categoría', () => {
    expect(api.finance).toHaveBeenCalledWith(6);
    const page = text();
    expect(page).toContain('S/ 94.80');
    expect(page).toContain('S/ 44.80 por Yape · 3 pagos');
    expect(page).toContain('Pérdida');
    expect(page).toContain('sep 2026');
    expect(page).toContain('Premium por Yape');
    expect(page).toContain('Cada mes desde sep 2026');
  });

  it('cambia de periodo pidiendo esos meses', async () => {
    await click('12 meses');
    expect(api.finance).toHaveBeenLastCalledWith(12);
  });

  it('anota un gasto mensual y vuelve a pedir las cuentas', async () => {
    fill('input[name=concept]', '  Dominio  ');
    fill('input[name=amount]', '40,5');
    page.querySelector<HTMLInputElement>('input[name=monthly]')!.click();
    await fixture.whenStable();
    fill('input[name=endMonth]', '2026-12');
    await click('Anotar');

    expect(api.saveFinanceEntry).toHaveBeenCalledWith(
      null,
      expect.objectContaining({
        kind: 'EXPENSE',
        concept: 'Dominio',
        category: 'tecnologia',
        amount: 40.5,
        monthly: true,
        endMonth: '2026-12',
      }),
    );
    expect(api.finance).toHaveBeenCalledTimes(2);
  });

  it('no manda un movimiento sin monto', async () => {
    fill('input[name=concept]', 'Volantes');
    await click('Anotar');
    expect(api.saveFinanceEntry).not.toHaveBeenCalled();
    expect(text()).toContain('Escribe un monto mayor que cero');
  });

  it('corrige y borra un movimiento tras confirmar', async () => {
    await click('Corregir');
    expect(page.querySelector<HTMLInputElement>('input[name=concept]')!.value).toBe('Supabase');
    await click('Guardar');
    expect(api.saveFinanceEntry).toHaveBeenCalledWith('m1', expect.objectContaining({ amount: 25 }));

    ui.confirm.mockResolvedValue(false);
    await click('Borrar');
    expect(api.deleteFinanceEntry).not.toHaveBeenCalled();
    ui.confirm.mockResolvedValue(true);
    await click('Borrar');
    expect(api.deleteFinanceEntry).toHaveBeenCalledWith('m1');
  });
});
