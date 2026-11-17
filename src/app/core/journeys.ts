import { BusRoute, GeoPoint, RouteStop } from './models';

/** Un tramo del viaje: o se camina, o se va en micro. */
export type JourneyLeg = WalkLeg | RideLeg;

export interface WalkLeg {
  kind: 'walk';
  meters: number;
  minutes: number;
}

export interface RideLeg {
  kind: 'ride';
  route: BusRoute;

  /**
   * Dónde se sube y dónde se baja. Los micros paran en cualquier punto de su
   * recorrido: el nombre es el del punto de referencia más cercano, y [near]
   * dice si queda tan cerca que es ese mismo.
   */
  from: RideStop;
  to: RideStop;
  minutes: number;

  /** El recorrido del micro entre los dos puntos, para dibujarlo. */
  line: GeoPoint[];
}

export interface RideStop extends GeoPoint {
  name: string;
  /** El punto es el de referencia, o queda a pocos pasos. */
  near: boolean;
}

/** Una forma de llegar: los tramos en orden, con su tiempo. */
export interface Journey {
  legs: JourneyLeg[];
  rides: RideLeg[];
  totalMinutes: number;
  walkMeters: number;
}

/**
 * Calcula cómo llegar de un punto a otro con los micros del catálogo, con uno
 * o con dos micros. Es la misma lógica que el planificador de la app Android
 * (`JourneyPlanner.kt`), sin la unión de recorridos vecinos.
 *
 * No hay horarios reales, así que los tiempos son estimaciones: lo que dura la
 * ruta completa se reparte según lo que se recorre de ella, y se suman unos
 * minutos de espera por cada micro. Sirve para comparar opciones, no para
 * prometer una hora de llegada.
 *
 * Se sube y se baja en cualquier punto del recorrido: en Trujillo los micros
 * paran donde se les pide.
 */
export function planJourneys(origin: GeoPoint, destination: GeoPoint, routes: BusRoute[]): Journey[] {
  const tracks = routes.filter((route) => lineOf(route).length >= 2).map((route) => new Track(route));
  const options = ridingOptions(origin, destination, tracks, MAX_WALK_TO_STOP_METERS);
  const rides = options.length > 0 ? options : ridingOptions(origin, destination, tracks, MAX_LONG_WALK_METERS);
  return rides
    .sort((a, b) => a.totalMinutes - b.totalMinutes || a.rides.length - b.rides.length || a.walkMeters - b.walkMeters)
    .slice(0, MAX_RESULTS);
}

/** Lo más que se espera que alguien camine hasta el micro. */
const MAX_WALK_TO_STOP_METERS = 900;

/** Lo que se acepta caminar cuando ningún micro pasa más cerca. */
const MAX_LONG_WALK_METERS = 2000;

/** Lo más que se camina al cambiar de micro. */
const MAX_TRANSFER_WALK_METERS = 500;

/** Espera típica del primer micro y de cada transbordo. */
const WAIT_MINUTES = 5;

/** Un tramo en micro más corto que esto no compensa: se camina. */
const MIN_RIDE_METERS = 400;

const MAX_RESULTS = 4;

/** Cuánto más lenta que la mejor puede ser una opción para seguir enseñándola. */
const MAX_SLOWER_FACTOR = 1.5;
const MAX_SLOWER_MINUTES = 5;

/** Cuántos micros se prueban a cada extremo de un transbordo: los que dejan más cerca. */
const MAX_TRANSFER_CANDIDATES = 10;

/** Cada cuánto se prueba a cambiar de micro a lo largo de un recorrido. */
const TRANSFER_STEP_METERS = 250;

/** Los puntos del recorrido más juntos que esto no aportan al calcular. */
const TRACK_MIN_GAP_METERS = 40;

/** Un punto a menos de esto de un punto de referencia es ese mismo. */
const AT_STOP_METERS = 80;

const WALK_METERS_PER_MINUTE = 80;

function ridingOptions(origin: GeoPoint, destination: GeoPoint, tracks: Track[], maxWalk: number): Journey[] {
  const direct = tracks.flatMap((track) => {
    const board = track.access(origin, maxWalk);
    const exit = track.access(destination, maxWalk);
    if (board === null || exit === null) return [];
    const journey = build(origin, destination, [{ track, from: board, to: exit }], maxWalk);
    return journey === null ? [] : [journey];
  });
  const directRoutes = new Set(direct.map((journey) => journey.rides[0].route));

  const candidates = (point: GeoPoint) =>
    tracks
      .flatMap((track) => {
        const access = track.access(point, maxWalk);
        return access === null ? [] : [{ track, access }];
      })
      .sort((a, b) => a.access.meters - b.access.meters)
      .slice(0, MAX_TRANSFER_CANDIDATES);

  const transfers: Journey[] = [];
  for (const { track: first, access: board } of candidates(origin)) {
    for (const { track: second, access: exit } of candidates(destination)) {
      // Cambiar de micro para acabar en uno que ya llevaba solo no tiene sentido.
      if (first === second || directRoutes.has(first.route) || directRoutes.has(second.route)) continue;
      if (!first.passesNear(second, MAX_TRANSFER_WALK_METERS)) continue;
      // Donde los dos recorridos se acercan; de cada pareja, el cambio más rápido.
      let best: Journey | null = null;
      for (let along = 0; along <= first.length; along += TRANSFER_STEP_METERS) {
        const take = second.access(first.pointAt(along), MAX_TRANSFER_WALK_METERS);
        if (take === null) continue;
        const journey = build(
          origin,
          destination,
          [
            { track: first, from: board, to: first.accessAt(along) },
            { track: second, from: take, to: exit },
          ],
          maxWalk,
        );
        if (journey !== null && (best === null || journey.totalMinutes < best.totalMinutes)) best = journey;
      }
      if (best !== null) transfers.push(best);
    }
  }

  const journeys = [...direct, ...transfers];
  const fastest = Math.min(...journeys.map((journey) => journey.totalMinutes));
  // Una opción mucho más lenta que la mejor solo estorba.
  return journeys.filter((journey) => journey.totalMinutes <= fastest * MAX_SLOWER_FACTOR + MAX_SLOWER_MINUTES);
}

interface Hop {
  track: Track;
  from: Access;
  to: Access;
}

function build(origin: GeoPoint, destination: GeoPoint, hops: Hop[], maxWalk: number): Journey | null {
  const legs: JourneyLeg[] = [];
  let minutes = 0;
  let walkMeters = 0;
  let current: GeoPoint = origin;

  const walkTo = (point: GeoPoint): boolean => {
    const meters = distance(current, point);
    if (meters > maxWalk) return false;
    if (meters > 0) {
      const time = walkMinutes(meters);
      legs.push({ kind: 'walk', meters, minutes: time });
      minutes += time;
      walkMeters += meters;
    }
    return true;
  };

  for (const { track, from, to } of hops) {
    const route = track.route;
    // La ida y la vuelta son rutas aparte: cada una se recorre en su sentido.
    if (!route.bidirectional && to.along <= from.along) return null;
    const rideMeters = Math.abs(to.along - from.along);
    if (rideMeters < MIN_RIDE_METERS) return null;
    // Subirse a un micro que aleja del destino no es una opción.
    if (distance(to.stop, destination) >= distance(from.stop, destination)) return null;
    if (!walkTo(from.stop)) return null;

    const rideTime = track.rideMinutes(rideMeters);
    legs.push({
      kind: 'ride',
      route,
      from: from.stop,
      to: to.stop,
      minutes: rideTime,
      line: track.slice(from.along, to.along),
    });
    minutes += rideTime + WAIT_MINUTES;
    current = to.stop;
  }
  if (!walkTo(destination)) return null;

  const rides = legs.filter((leg): leg is RideLeg => leg.kind === 'ride');
  return { legs, rides, totalMinutes: minutes, walkMeters };
}

/** Dónde se sube o se baja: el punto, a qué altura del recorrido cae y cuánto se camina hasta él. */
interface Access {
  stop: RideStop;
  along: number;
  meters: number;
}

/** El recorrido de una ruta como línea medible, en metros desde su principio. */
class Track {
  readonly points: GeoPoint[];
  private readonly alongs: number[];
  readonly length: number;
  private readonly south: number;
  private readonly north: number;
  private readonly west: number;
  private readonly east: number;

  constructor(readonly route: BusRoute) {
    this.points = thin(lineOf(route));
    this.alongs = [0];
    for (let i = 1; i < this.points.length; i++)
      this.alongs.push(this.alongs[i - 1] + distance(this.points[i - 1], this.points[i]));
    this.length = this.alongs[this.alongs.length - 1];
    const lats = this.points.map((point) => point.latitude);
    const lons = this.points.map((point) => point.longitude);
    [this.south, this.north, this.west, this.east] = [
      Math.min(...lats),
      Math.max(...lats),
      Math.min(...lons),
      Math.max(...lons),
    ];
  }

  /** Si los rectángulos de los dos recorridos quedan a menos de [meters]: una criba barata. */
  passesNear(other: Track, meters: number): boolean {
    const margin = meters / 111000;
    return (
      this.south - margin <= other.north &&
      other.south - margin <= this.north &&
      this.west - margin <= other.east &&
      other.west - margin <= this.east
    );
  }

  /** Por dónde subir o bajar para un punto; `null` si el recorrido queda a más de [limit]. */
  access(point: GeoPoint, limit: number): Access | null {
    const projection = this.project(point);
    if (projection.meters > limit) return null;
    return { ...this.accessAt(projection.along), meters: projection.meters };
  }

  /** El punto del recorrido a [along] metros del principio, con el nombre de su referencia más cercana. */
  accessAt(along: number): Access {
    const point = this.pointAt(along);
    const nearest = this.nearestStop(point);
    const near = nearest !== null && nearest.meters <= AT_STOP_METERS;
    const stop: RideStop = near
      ? { latitude: nearest.stop.latitude, longitude: nearest.stop.longitude, name: nearest.stop.name, near }
      : { ...point, name: nearest?.stop.name ?? this.route.name, near };
    return { stop, along: Math.min(this.length, Math.max(0, along)), meters: 0 };
  }

  pointAt(along: number): GeoPoint {
    const target = Math.min(this.length, Math.max(0, along));
    const next = this.alongs.findIndex((value) => value >= target);
    if (next <= 0) return this.points[0];
    const span = this.alongs[next] - this.alongs[next - 1];
    return between(this.points[next - 1], this.points[next], span <= 0 ? 0 : (target - this.alongs[next - 1]) / span);
  }

  /** El tramo del recorrido entre dos alturas, en el sentido en que se viaja. */
  slice(from: number, to: number): GeoPoint[] {
    const [low, high] = [Math.min(from, to), Math.max(from, to)];
    const line = [
      this.pointAt(low),
      ...this.points.filter((_, index) => this.alongs[index] > low && this.alongs[index] < high),
      this.pointAt(high),
    ];
    return from <= to ? line : line.reverse();
  }

  /** El tiempo de la ruta completa, repartido según lo que se recorre de ella. */
  rideMinutes(meters: number): number {
    if (this.length <= 0 || this.route.durationMinutes <= 0) return Math.max(1, Math.ceil(meters / 300));
    return Math.max(1, Math.ceil((this.route.durationMinutes * meters) / this.length));
  }

  private nearestStop(point: GeoPoint): { stop: RouteStop; meters: number } | null {
    let best: { stop: RouteStop; meters: number } | null = null;
    for (const stop of this.route.stops) {
      const meters = distance(stop, point);
      if (best === null || meters < best.meters) best = { stop, meters };
    }
    return best;
  }

  /** El punto del recorrido más cercano a [point]: a qué altura cae y a cuántos metros queda. */
  private project(point: GeoPoint): { along: number; meters: number } {
    let best = { along: 0, meters: Infinity };
    for (let i = 1; i < this.points.length; i++) {
      const [a, b] = [this.points[i - 1], this.points[i]];
      const t = projectOnSegment(point, a, b);
      const meters = distance(between(a, b, t), point);
      if (meters < best.meters) best = { along: this.alongs[i - 1] + (this.alongs[i] - this.alongs[i - 1]) * t, meters };
    }
    return best;
  }
}

/** Sin trazado dibujado, la línea une los puntos de referencia. */
const lineOf = (route: BusRoute): GeoPoint[] => (route.path.length >= 2 ? route.path : route.stops);

/** Un trazado grabado trae miles de puntos casi pegados: para medir sobran. */
function thin(raw: GeoPoint[]): GeoPoint[] {
  const kept: GeoPoint[] = [];
  raw.forEach((point, index) => {
    const last = kept[kept.length - 1];
    if (last === undefined || index === raw.length - 1 || distance(last, point) >= TRACK_MIN_GAP_METERS)
      kept.push(point);
  });
  return kept;
}

/** Por dónde de [a]–[b] cae [point]: 0 en [a], 1 en [b]. El suelo se trata como plano. */
function projectOnSegment(point: GeoPoint, a: GeoPoint, b: GeoPoint): number {
  const shrink = Math.cos((point.latitude * Math.PI) / 180);
  const ax = (a.longitude - point.longitude) * shrink;
  const ay = a.latitude - point.latitude;
  const dx = (b.longitude - a.longitude) * shrink;
  const dy = b.latitude - a.latitude;
  const length = dx * dx + dy * dy;
  return length === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / length));
}

const between = (a: GeoPoint, b: GeoPoint, t: number): GeoPoint => ({
  latitude: a.latitude + (b.latitude - a.latitude) * t,
  longitude: a.longitude + (b.longitude - a.longitude) * t,
});

/** Metros entre dos puntos, en línea recta. */
export function distance(a: GeoPoint, b: GeoPoint): number {
  const toRad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * toRad;
  const dLon = (b.longitude - a.longitude) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * toRad) * Math.cos(b.latitude * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

const walkMinutes = (meters: number): number => Math.max(1, Math.ceil(meters / WALK_METERS_PER_MINUTE));
