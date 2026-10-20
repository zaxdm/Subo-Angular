import { Component, computed, input, signal } from '@angular/core';

/** Una serie del gráfico: qué campo de cada día cuenta y cómo se llama. */
export interface DaySeries {
  key: string;
  label: string;
  /** Una variable de color de la hoja de estilos, p. ej. `var(--chart-1)`. */
  color: string;
}

/** Un día con sus valores: `day` es "2026-10-19" y el resto, números por serie. */
export type DayPoint = { day: string } & Record<string, number | string>;

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "19 oct": el día como lo dice la gente. */
export const shortDay = (day: string): string => {
  const [, month, date] = day.split('-').map(Number);
  return `${date} ${MONTHS[month - 1] ?? ''}`;
};

/** Un tope redondo por encima del máximo, para que las líneas guía caigan en números limpios. */
function niceMax(value: number): number {
  if (value <= 4) return 4;
  const step = 10 ** Math.floor(Math.log10(value));
  for (const factor of [1, 2, 2.5, 5, 10]) {
    if (factor * step >= value) return factor * step;
  }
  return 10 * step;
}

const HEIGHT = 160;
const SLOT = 12;

/**
 * Columnas por día, apiladas cuando hay varias series (sus valores suman el
 * total del día). Al pasar por encima de un día se ve su detalle.
 */
@Component({
  selector: 'app-day-chart',
  styleUrl: './day-chart.css',
  templateUrl: './day-chart.html',
})
export class DayChart {
  readonly series = input.required<DaySeries[]>();
  readonly data = input.required<DayPoint[]>();
  /** Cómo se llama lo que se cuenta, para la etiqueta: "personas", "descargas"… */
  readonly unit = input('');

  protected readonly height = HEIGHT;
  protected readonly slot = SLOT;
  protected readonly hovered = signal<number | null>(null);

  protected readonly width = computed(() => Math.max(1, this.data().length) * SLOT);

  private readonly totals = computed(() =>
    this.data().map((point) => this.series().reduce((sum, item) => sum + Number(point[item.key] ?? 0), 0)),
  );

  protected readonly max = computed(() => niceMax(Math.max(0, ...this.totals())));

  protected readonly guides = computed(() => {
    const max = this.max();
    return [0, max / 2, max].map((value) => ({ value, y: HEIGHT - (value / max) * HEIGHT }));
  });

  /** Cada columna con sus tramos, de abajo arriba; 2 px de aire entre tramos. */
  protected readonly columns = computed(() => {
    const max = this.max();
    const width = Math.max(2, SLOT - 4);
    return this.data().map((point, index) => {
      let top = HEIGHT;
      const parts = this.series()
        .map((item) => {
          const value = Number(point[item.key] ?? 0);
          const size = (value / max) * HEIGHT;
          const part = { color: item.color, y: top - size, height: Math.max(0, size - 1) };
          top -= size;
          return value > 0 ? part : null;
        })
        .filter((part) => part !== null);
      return { x: index * SLOT + 2, width, parts, total: this.totals()[index] };
    });
  });

  /** Las fechas bajo el eje: la primera, la del medio y la última. */
  protected readonly ticks = computed(() => {
    const data = this.data();
    if (data.length === 0) return [];
    const picks = [...new Set([0, Math.floor((data.length - 1) / 2), data.length - 1])];
    return picks.map((index) => ({
      left: ((index + 0.5) * SLOT * 100) / this.width(),
      label: shortDay(data[index].day),
    }));
  });

  protected readonly tip = computed(() => {
    const index = this.hovered();
    if (index === null) return null;
    const point = this.data()[index];
    if (!point) return null;
    return {
      left: Math.min(88, Math.max(12, ((index + 0.5) * SLOT * 100) / this.width())),
      day: shortDay(point.day),
      total: this.totals()[index],
      rows: this.series().map((item) => ({ ...item, value: Number(point[item.key] ?? 0) })),
    };
  });

  protected readonly empty = computed(() => this.totals().every((total) => total === 0));
}
