import { BusRoute, GeoPoint } from './models';
import { spotOnLine } from './nearby';

/**
 * Las rutas de una misma empresa y letra son una sola línea: el catálogo
 * guarda cada sentido (y cada variante) como una ruta aparte.
 */
export interface ServiceLine {
  key: string;
  name: string;
  letter: string;
  routes: ServiceRoute[];
}

export interface ServiceRoute {
  route: BusRoute;
  /** «Ida», «Vuelta», «Ida 2»…; vacío si la línea tiene un solo recorrido. */
  direction: string;
  /** El recorrido que ya hace lo mismo, si este lo repite. */
  duplicateOf: BusRoute | null;
}

/** Recorridos más parecidos que esto, de media, son el mismo. */
const DUPLICATE_METERS = 20;

/** Puntos que se comparan de cada recorrido: con más no se gana precisión. */
const SAMPLES = 24;

/** Un nombre sin mayúsculas, espacios de más ni adornos («C2♡» es «c2»). */
const plain = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Empresa y letra, sin fijarse en mayúsculas, espacios ni adornos. */
export const serviceKey = (route: BusRoute): string => `${plain(route.name)}|${plain(route.letter)}`;

/** Sin trazado dibujado, la línea une los puntos de referencia. */
const lineOf = (route: BusRoute): GeoPoint[] => (route.path.length >= 2 ? route.path : route.stops);

function sample(line: GeoPoint[]): GeoPoint[] {
  if (line.length <= SAMPLES) return line;
  return Array.from({ length: SAMPLES }, (_, i) => line[Math.round((i * (line.length - 1)) / (SAMPLES - 1))]);
}

/**
 * Si [route] va en el mismo sentido que [first]. Primero lo dicen los nombres,
 * que es lo que lee la gente: la vuelta sale de donde llega la ida. Si no se
 * puede por los nombres, lo dice el mapa.
 */
function sameWay(first: BusRoute, route: BusRoute): boolean {
  const [origin, destination] = [plain(first.origin), plain(first.destination)];
  if (origin !== '' && destination !== '' && origin !== destination) {
    if (plain(route.origin) === origin && plain(route.destination) === destination) return true;
    if (plain(route.origin) === destination && plain(route.destination) === origin) return false;
  }
  return sameWayOnMap(lineOf(first), lineOf(route));
}

/**
 * Si [other] recorre el mapa en el mismo sentido que [reference]. Lo dicen sus
 * extremos: la vuelta sale de donde llega la ida. En una circular, que empieza
 * y acaba en el mismo sitio, se mira el orden: sus puntos caen cada vez más
 * adelante sobre la otra línea.
 */
function sameWayOnMap(reference: GeoPoint[], other: GeoPoint[]): boolean {
  if (reference.length < 2 || other.length < 2) return true;
  const gap = (a: GeoPoint, b: GeoPoint) => spotOnLine(a, [b]).meters;
  const [start, end] = [reference[0], reference[reference.length - 1]];
  const [from, to] = [other[0], other[other.length - 1]];
  const straight = gap(start, from) + gap(end, to);
  const reversed = gap(start, to) + gap(end, from);
  if (Math.min(straight, reversed) < Math.max(straight, reversed) / 2) return straight <= reversed;

  const ats = sample(other).map((point) => spotOnLine(point, reference).at);
  let forward = 0;
  for (let i = 1; i < ats.length; i++) forward += Math.sign(ats[i] - ats[i - 1]);
  return forward >= 0;
}

/** Lo que se separan de media dos recorridos, mirado desde los dos lados. */
function apart(a: GeoPoint[], b: GeoPoint[]): number {
  const mean = (from: GeoPoint[], to: GeoPoint[]) => {
    const points = sample(from);
    return points.reduce((sum, point) => sum + spotOnLine(point, to).meters, 0) / points.length;
  };
  return Math.max(mean(a, b), mean(b, a));
}

/**
 * Agrupa las rutas por empresa y letra, en el orden en que aparecen, y dice el
 * sentido de cada una: la primera de la línea es la ida, y las que la recorren
 * al revés, la vuelta. Marca como repetida la que hace lo mismo que otra.
 */
export function groupServices(routes: BusRoute[]): ServiceLine[] {
  const groups = new Map<string, BusRoute[]>();
  for (const route of routes) {
    const key = serviceKey(route);
    groups.set(key, [...(groups.get(key) ?? []), route]);
  }
  return [...groups].map(([key, members]) => {
    // Con dos recorridos, uno es la ida y el otro la vuelta, aunque sea circular
    // o el nombre no lo diga.
    const ways = members.map((route, index) => index === 0 || (members.length !== 2 && sameWay(members[0], route)));
    const outbound = ways.filter((way) => way).length;
    const inbound = ways.length - outbound;
    const counters = { ida: 0, vuelta: 0 };
    const services = members.map((route, index): ServiceRoute => {
      const forward = ways[index];
      const word = forward ? 'Ida' : 'Vuelta';
      const count = forward ? ++counters.ida : ++counters.vuelta;
      const several = forward ? outbound > 1 : inbound > 1;
      // Repetida: por las mismas calles y en el mismo sentido que otra anterior.
      const twin = members
        .slice(0, index)
        .find(
          (other) =>
            apart(lineOf(other), lineOf(route)) <= DUPLICATE_METERS && sameWayOnMap(lineOf(other), lineOf(route)),
        );
      return {
        route,
        direction: members.length === 1 ? '' : several ? `${word} ${count}` : word,
        duplicateOf: twin ?? null,
      };
    });
    return { key, name: members[0].name, letter: members[0].letter, routes: services };
  });
}

/** El sentido de cada ruta, para ponerle su etiqueta donde se liste suelta. */
export function directionsOf(routes: BusRoute[]): Map<BusRoute, string> {
  return new Map(groupServices(routes).flatMap((line) => line.routes.map((item) => [item.route, item.direction])));
}
