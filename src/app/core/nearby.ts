import { GeoPoint } from './models';

/**
 * Los metros que hay de [point] al tramo más cercano de [line]. Infinito si la
 * línea no tiene puntos.
 *
 * Trata el suelo como plano alrededor de [point]: dentro de una ciudad el
 * error es de centímetros, y así no hace falta trigonometría esférica para
 * cada tramo de cada línea.
 */
export function metersToLine(point: GeoPoint, line: GeoPoint[]): number {
  if (line.length === 0) return Infinity;
  const metersPerDegree = 111320;
  const shrink = Math.cos((point.latitude * Math.PI) / 180);
  // Cada punto, en metros al este y al norte de [point].
  const east = (other: GeoPoint) => (other.longitude - point.longitude) * metersPerDegree * shrink;
  const north = (other: GeoPoint) => (other.latitude - point.latitude) * metersPerDegree;

  let best = Infinity;
  let ax = east(line[0]);
  let ay = north(line[0]);
  if (line.length === 1) return Math.hypot(ax, ay);
  for (let i = 1; i < line.length; i++) {
    const bx = east(line[i]);
    const by = north(line[i]);
    const dx = bx - ax;
    const dy = by - ay;
    const length = dx * dx + dy * dy;
    // Por dónde cae [point] a lo largo del tramo: 0 en un extremo, 1 en el otro.
    const along = length === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / length));
    const x = ax + dx * along;
    const y = ay + dy * along;
    best = Math.min(best, x * x + y * y);
    ax = bx;
    ay = by;
  }
  return Math.sqrt(best);
}
