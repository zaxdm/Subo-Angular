import { BusRoute, GeoPoint, copyRoute } from './models';

/** Un camino que sigue las calles. */
export interface StreetPath {
  points: GeoPoint[];
  meters: number;
}

const BASE = 'https://routing.openstreetmap.de/routed-car/route/v1/driving';

/** Puntos por petición: con más, la dirección no cabe. */
const CHUNK = 80;

/** Las coordenadas van como longitud,latitud separadas por punto y coma. */
export function streetUrl(points: GeoPoint[]): string {
  const coordinates = points.map((point) => `${point.longitude.toFixed(6)},${point.latitude.toFixed(6)}`).join(';');
  return `${BASE}/${coordinates}?overview=full&geometries=geojson`;
}

/** Lee la respuesta de OSRM; `null` si no trae un camino usable. */
export function parseStreetPath(body: string): StreetPath | null {
  try {
    const root = JSON.parse(body);
    if (root.code !== 'Ok') return null;
    const route = root.routes[0];
    // GeoJSON guarda [longitud, latitud].
    const points: GeoPoint[] = route.geometry.coordinates.map((pair: number[]) => ({
      latitude: pair[1],
      longitude: pair[0],
    }));
    if (points.length < 2 || points.some((point) => !isFinite(point.latitude) || !isFinite(point.longitude))) {
      return null;
    }
    return { points, meters: typeof route.distance === 'number' ? route.distance : 0 };
  } catch {
    return null;
  }
}

async function request(points: GeoPoint[]): Promise<StreetPath | null> {
  try {
    const response = await fetch(streetUrl(points), { signal: AbortSignal.timeout(25_000) });
    return response.status === 200 ? parseStreetPath(await response.text()) : null;
  } catch {
    return null;
  }
}

/**
 * Traza por las calles el camino que pasa por unos puntos, en orden, con el
 * servicio OSRM público de FOSSGIS (routing.openstreetmap.de), el mismo que
 * usa la app: gratuito, sin clave y basado en OpenStreetMap.
 *
 * Sus condiciones piden no pasar de una petición por segundo y evitar el uso
 * intensivo: aquí solo se llama cuando alguien del equipo pulsa el botón.
 *
 * `null` si el servicio no responde o no encuentra un camino.
 */
export async function traceStreets(points: GeoPoint[]): Promise<StreetPath | null> {
  if (points.length < 2) return null;
  const path: GeoPoint[] = [];
  let meters = 0;
  // Los tramos se encadenan: cada uno empieza donde acabó el anterior.
  for (let start = 0; start < points.length - 1; start += CHUNK - 1) {
    if (start > 0) await new Promise((resolve) => setTimeout(resolve, 1000));
    const piece = await request(points.slice(start, start + CHUNK));
    if (piece === null) return null;
    path.push(...(path.length === 0 ? piece.points : piece.points.slice(1)));
    meters += piece.meters;
  }
  return path.length < 2 ? null : { points: path, meters };
}

const limit = (name: string): string => name.slice(0, 80);

/**
 * Una ruta nueva con los datos de [route], para no volver a escribirlos: sirve
 * para las variantes de una misma empresa. Con [reversed] es su vuelta: mismos
 * puntos en el orden contrario, y origen y destino cambiados.
 *
 * Queda sin guardar y como pendiente, para que no se publique sin revisarla.
 */
export function duplicateRoute(route: BusRoute, reversed = false): BusRoute {
  const copy: BusRoute = { ...copyRoute(route), id: null, status: 'PENDING' };
  if (!reversed) return { ...copy, name: limit(`${route.name.trim()} (copia)`) };
  return {
    ...copy,
    name: limit(`${route.name.trim()} (vuelta)`),
    origin: route.destination,
    destination: route.origin,
    // La ida y la vuelta ya son dos rutas distintas.
    bidirectional: false,
    stops: copy.stops.reverse(),
    path: copy.path.reverse(),
  };
}
