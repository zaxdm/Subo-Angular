import { GeoPoint } from './models';
import { SiteInfo } from './site-info';

/** Un viaje que alguien comparte en vivo desde la app, tal como lo ve quien tiene el enlace. */
export interface LiveTrip {
  /** El nombre de pila de quien viaja. */
  name: string;
  routeId: string | null;

  /** Dónde se baja, si lo dijo. */
  stop: (GeoPoint & { name: string }) | null;

  /** Por dónde va; `null` si aún no hay posición o el viaje terminó. */
  position: GeoPoint | null;
  updatedAt: Date;
  ended: boolean;
}

/** Con una posición más vieja que esto, se avisa de que se perdió la señal. */
export const TRIP_STALE_MS = 2 * 60_000;

const TIMEOUT_MS = 20_000;

const number = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

function point(latitude: unknown, longitude: unknown): GeoPoint | null {
  const lat = number(latitude);
  const lon = number(longitude);
  return lat === null || lon === null ? null : { latitude: lat, longitude: lon };
}

/**
 * Pide al servidor cómo va el viaje. No pide sesión: el enlace es la llave.
 * Devuelve `null` si ese viaje no existe; lanza un error si no hubo conexión.
 */
export async function fetchLiveTrip(id: string): Promise<LiveTrip | null> {
  const response = await fetch(`${SiteInfo.serverUrl}/api/trips/${encodeURIComponent(id)}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`El servidor respondió ${response.status}`);
  const json = (await response.json()) as Record<string, unknown>;
  const stop = json['stop'] as Record<string, unknown> | null;
  const stopPoint = stop ? point(stop['latitude'], stop['longitude']) : null;
  return {
    name: typeof json['name'] === 'string' ? json['name'] : '',
    routeId: typeof json['routeId'] === 'string' ? json['routeId'] : null,
    stop: stopPoint ? { ...stopPoint, name: typeof stop?.['name'] === 'string' ? stop['name'] : '' } : null,
    position: point(json['latitude'], json['longitude']),
    updatedAt: new Date(number(json['updatedAt']) ?? 0),
    ended: json['ended'] === true,
  };
}

/** «hace un momento», «hace 40 s», «hace 3 min»: cuánto hace de [then]. */
export function ago(then: Date, now: number): string {
  const seconds = Math.max(0, Math.round((now - then.getTime()) / 1000));
  if (seconds < 15) return 'hace un momento';
  if (seconds < 90) return `hace ${seconds} s`;
  return `hace ${Math.round(seconds / 60)} min`;
}
