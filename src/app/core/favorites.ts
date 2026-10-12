import { GeoPoint } from './models';
import { load, save } from './storage';

/**
 * Qué es el lugar para quien lo guarda: decide el nombre y el icono con que
 * se muestra. Los códigos son los mismos que usa la app Android.
 */
export interface FavoriteKind {
  code: string;
  label: string;
  icon: string;
}

export const FAVORITE_KINDS: FavoriteKind[] = [
  { code: 'HOME', label: 'Casa', icon: 'home' },
  { code: 'WORK', label: 'Trabajo', icon: 'work_outline' },
  { code: 'STUDY', label: 'Estudio', icon: 'school' },
  { code: 'PARTNER', label: 'Pareja', icon: 'favorite_border' },
  { code: 'FAMILY', label: 'Familia', icon: 'family_restroom' },
  { code: 'GYM', label: 'Gimnasio', icon: 'fitness_center' },
  { code: 'OTHER', label: 'Otro', icon: 'star_border' },
];

export const OTHER_KIND = FAVORITE_KINDS[FAVORITE_KINDS.length - 1];

/** Un tipo que esta versión no conoce no se pierde: pasa a "otro". */
const kindOf = (code: unknown): FavoriteKind => FAVORITE_KINDS.find((kind) => kind.code === code) ?? OTHER_KIND;

/** Un lugar favorito: casa, trabajo, la pareja… */
export interface FavoritePlace extends GeoPoint {
  kind: FavoriteKind;

  /** El nombre que le puso quien lo guardó; vacío si se queda con el del tipo. */
  name: string;
}

export const favoriteLabel = (place: FavoritePlace): string => (place.name === '' ? place.kind.label : place.name);

/** Más que estos dejan de ser "los de siempre" y vuelven a ser una lista que recorrer. */
export const MAX_FAVORITES = 4;

const KEY = 'favorite_places';

/**
 * Los lugares favoritos guardados, en el orden en que se añadieron; ninguno
 * si no hay o no se pueden leer. Se guardan en este navegador y no salen de él.
 */
export function loadFavorites(): FavoritePlace[] {
  try {
    const raw = load(KEY);
    if (raw === null) return [];
    return (JSON.parse(raw) as Record<string, unknown>[]).slice(0, MAX_FAVORITES).map((item) => ({
      kind: kindOf(item['kind']),
      name: typeof item['name'] === 'string' ? item['name'] : '',
      latitude: Number(item['latitude']),
      longitude: Number(item['longitude']),
    }));
  } catch {
    return [];
  }
}

export function storeFavorites(places: FavoritePlace[]): void {
  save(KEY, JSON.stringify(places.map((place) => ({ ...place, kind: place.kind.code }))));
}
