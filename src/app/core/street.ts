import { GeoPoint } from './models';
import { spotOnLine } from './nearby';

// Servicios públicos de OpenStreetMap, gratuitos y sin clave, los mismos que
// usa la app: Photon para sugerir lugares mientras se escribe y el OSRM de
// FOSSGIS para el camino a pie. Piden un uso razonable: se guarda lo ya
// preguntado y se pregunta solo cuando hace falta.

/** Un sitio que sugiere el buscador, con la calle o el barrio que lo distinguen. */
export interface PlaceSuggestion extends GeoPoint {
  name: string;
  detail: string;
}

const PHOTON_URL = 'https://photon.komoot.io/api/';

/** Trujillo y sus distritos: oeste, sur, este, norte. */
const TRUJILLO_BOX = '-79.25,-8.35,-78.80,-7.90';
const MAX_SUGGESTIONS = 8;

/** Dos sitios con el mismo nombre a menos de esto son el mismo. */
const SAME_PLACE_METERS = 150;

const suggested = new Map<string, PlaceSuggestion[]>();

/** Lugares que se llaman como [query], los cercanos a [near] primero; `null` si el buscador no contestó. */
export async function suggestPlaces(query: string, near: GeoPoint | null): Promise<PlaceSuggestion[] | null> {
  const text = query.trim();
  if (text.length < 2) return [];
  const key = text.toLowerCase();
  const known = suggested.get(key);
  if (known) return known;

  const params = new URLSearchParams({ q: text, limit: String(MAX_SUGGESTIONS), bbox: TRUJILLO_BOX });
  if (near) {
    params.set('lat', near.latitude.toFixed(5));
    params.set('lon', near.longitude.toFixed(5));
  }
  try {
    const response = await fetch(`${PHOTON_URL}?${params}`);
    if (!response.ok) return null;
    const places = parsePhoton(await response.json());
    suggested.set(key, places);
    return places;
  } catch {
    return null;
  }
}

/** Las sugerencias de una respuesta de Photon, sin repetir el mismo sitio. */
export function parsePhoton(json: unknown): PlaceSuggestion[] {
  const features = (json as { features?: unknown })?.features;
  if (!Array.isArray(features)) return [];
  const places: PlaceSuggestion[] = [];
  for (const feature of features) {
    const coordinates = feature?.geometry?.coordinates;
    const properties = feature?.properties ?? {};
    if (!Array.isArray(coordinates)) continue;
    const [longitude, latitude] = coordinates;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') continue;
    const text = (key: string): string | null => {
      const value = properties[key];
      return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
    };
    const name = text('name') ?? text('street');
    if (name === null) continue;
    // La calle y el barrio dicen cuál de varios sitios con el mismo nombre es.
    const detail = [...new Set([text('street'), text('district') ?? text('locality'), text('city')])]
      .filter((part): part is string => part !== null && part !== name)
      .slice(0, 2)
      .join(', ');
    const point = { latitude, longitude };
    const repeated = places.some(
      (other) =>
        other.name.toLowerCase() === name.toLowerCase() && spotOnLine(point, [other]).meters < SAME_PLACE_METERS,
    );
    if (!repeated) places.push({ name, detail, latitude, longitude });
  }
  return places;
}

/** Un camino por las calles. */
export interface StreetPath {
  points: GeoPoint[];
  meters: number;
  seconds: number;
}

const ROUTER_URL = 'https://routing.openstreetmap.de';

const walked = new Map<string, StreetPath | null>();

/**
 * El camino a pie de [from] a [to] por las calles; `null` si el servicio no
 * contesta o manda dar un rodeo absurdo (entonces se dibuja la línea recta).
 */
export async function walkingPath(from: GeoPoint, to: GeoPoint): Promise<StreetPath | null> {
  // Con 4 decimales (unos 10 m) se reaprovecha el camino si apenas se movió.
  const key = [from.latitude, from.longitude, to.latitude, to.longitude].map((n) => n.toFixed(4)).join(',');
  if (walked.has(key)) return walked.get(key)!;
  const straight = spotOnLine(from, [to]).meters;
  // El mapa no deja caminar por algunas vías grandes aunque la gente sí ande
  // por su berma: si a pie da un rodeo, se prueba el camino de los carros.
  let path: StreetPath | null = null;
  for (const profile of ['routed-foot', 'routed-car']) {
    const found = await request(profile, from, to);
    if (found !== null && !isDetour(found.meters, straight)) {
      path = found;
      break;
    }
  }
  walked.set(key, path);
  return path;
}

/** Un camino a pie tan largo frente a la línea recta es un rodeo, no un camino. */
export const isDetour = (pathMeters: number, straightMeters: number): boolean =>
  pathMeters > straightMeters * 1.7 + 120;

async function request(profile: string, from: GeoPoint, to: GeoPoint): Promise<StreetPath | null> {
  const ends = [from, to].map((point) => `${point.longitude.toFixed(6)},${point.latitude.toFixed(6)}`).join(';');
  try {
    const response = await fetch(`${ROUTER_URL}/${profile}/route/v1/driving/${ends}?overview=full&geometries=geojson`);
    if (!response.ok) return null;
    const route = (await response.json())?.routes?.[0];
    const coordinates = route?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
    return {
      points: coordinates.map(([longitude, latitude]: number[]) => ({ latitude, longitude })),
      meters: Number(route.distance) || 0,
      seconds: Number(route.duration) || 0,
    };
  } catch {
    return null;
  }
}
