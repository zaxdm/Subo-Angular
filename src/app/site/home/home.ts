import {
  Component,
  ElementRef,
  HostBinding,
  OnDestroy,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import * as L from 'leaflet';

import { Api } from '../../core/api';
import { mapTip } from '../../core/map-tip';
import {
  FAVORITE_KINDS,
  FavoriteKind,
  FavoritePlace,
  MAX_FAVORITES,
  OTHER_KIND,
  favoriteLabel,
  loadFavorites,
  storeFavorites,
} from '../../core/favorites';
import { Fix, currentLocation } from '../../core/locate';
import {
  ApiError,
  alertLabel,
  BusRoute,
  CityAlert,
  Destination,
  GeoPoint,
  formatSoles,
  messageOf,
  routeTitle,
  safeUrl,
} from '../../core/models';
import { groupServices, serviceKey } from '../../core/directions';
import { RIDERS, Rider, taxiEstimate, totalFare } from '../../core/fares';
import { Journey, distance, planJourneys } from '../../core/journeys';
import { metersToLine, spotOnLine } from '../../core/nearby';
import { PlaceSuggestion, StreetPath, suggestPlaces, walkingPath } from '../../core/street';
import { load, save } from '../../core/storage';
import { SiteInfo } from '../../core/site-info';
import { Store } from '../../core/store';
import { Ui } from '../../core/ui';
import { AssistantVoice } from './assistant-voice';

type Tab = 'lines' | 'assistant' | 'alerts';

/** Las dos listas de rutas: las que pasan cerca de quien mira o todas. */
type LineFilter = 'near' | 'all';

/** Una ruta de la lista, con lo que hay que andar hasta ella si se sabe. */
interface LineRow {
  route: BusRoute;
  meters: number | null;
}

/** Los tipos de alerta, en el orden de la app, para filtrar la lista. */
/** Cuántas rutas cercanas se enseñan a la vez; la flecha pasa a las siguientes. */
const NEAR_PAGE = 5;

const ALERT_TYPES = ['TRAFFIC', 'ACCIDENT', 'OVERCHARGE', 'ROADWORK', 'CROWDED', 'DANGER', 'OTHER'];

/** El icono de cada tipo de alerta, como en la app. */
const ALERT_ICONS: Record<string, string> = {
  TRAFFIC: 'traffic',
  ACCIDENT: 'car_crash',
  OVERCHARGE: 'payments',
  ROADWORK: 'construction',
  CROWDED: 'groups',
  DANGER: 'flag',
  OTHER: 'more_horiz',
};

/** Lo que se considera «cerca de ti» en la lista de rutas. */
const NEAR_ME_METERS = 1500;

/** Lo que anda una persona en un minuto, más o menos. */
const WALK_METERS_PER_MINUTE = 80;

/** Un mensaje de la conversación con el asistente. */
interface Message {
  text: string;
  mine: boolean;

  /** Las líneas que recomienda, la mejor primero, para abrirlas con un toque. */
  routes: BusRoute[];

  /** Es el aviso de un fallo, no parte de la conversación. */
  failed?: boolean;
}

/** El fondo del mapa: calles o foto desde el aire. Ninguno pide clave. */
interface MapBase {
  url: string;

  /** A quién hay que nombrar, a la vista, por usar sus imágenes. */
  credit: string;
  maxNativeZoom: number;
}

const STREETS: MapBase = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  credit: '© OpenStreetMap',
  maxNativeZoom: 19,
};

/** World Imagery, de Esri. */
const SATELLITE: MapBase = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  credit: 'Imágenes © Esri, Maxar, Earthstar Geographics',
  maxNativeZoom: 18,
};

/** Dónde se recuerda el ancho del panel, y lo mínimo que se deja al panel y al mapa. */
const PANEL_WIDTH_KEY = 'panel_width';
/** Dónde se recuerda qué pasaje paga quien mira: el general o un medio pasaje. */
const RIDER_KEY = 'rider';

/** Una alerta de zona peligrosa a menos de esto del recorrido se avisa en la ficha. */
const DANGER_NEAR_METERS = 250;

/** Dónde se recuerda que el panel quedó escondido. */
const PANEL_HIDDEN_KEY = 'panel_hidden';
const PANEL_MIN_WIDTH = 340;
const MAP_MIN_WIDTH = 320;

/** En el celular, qué parte de la pantalla ocupa el mapa con la hoja baja, a media altura o alta. */
const SHEET_MAP_SHARE = { low: 0.72, mid: 0.44, high: 0.14 };

const TRUJILLO: L.LatLngTuple = [-8.112, -79.0288];

/** El zoom con el que se abre el mapa: la ciudad entera, con sus calles. */
const CITY_ZOOM = 13;

// Más lejos que el mínimo ya no se distingue la ciudad.
const MIN_ZOOM = 10;
const MAX_ZOOM = 19;

/** Lo que se espera a que alguien deje de escribir antes de sugerirle lugares. */
const SEARCH_PAUSE_MS = 400;

/** Una distancia a pie, como se dice: «250 m» o «1,4 km». */
const walk = (meters: number): string =>
  meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1).replace('.', ',')} km`;

/** Un color por línea, para distinguirlas en el mapa. */
const LINE_COLORS = ['#0f766e', '#c2410c', '#1d4ed8', '#a21caf', '#15803d', '#6d28d9', '#8a6100', '#0f4c5c'];

const MAP_BLUE = '#1a73e8';

const latLng = (point: GeoPoint): L.LatLngTuple => [point.latitude, point.longitude];

/** Una marca del mapa hecha con HTML: un círculo o un cuadrito con un texto o un icono dentro, y su color si lo lleva. */
function badge(className: string, text = '', size = 30, color?: string): L.DivIcon {
  const element = document.createElement('div');
  element.className = `mk ${className}`;
  element.textContent = text;
  if (color) element.style.setProperty('--route', color);
  return L.divIcon({ className: '', html: element, iconSize: [size, size] });
}

/**
 * La portada del mapa, como en la app: el mapa de la ciudad con todas las
 * líneas y, al lado, el panel con las líneas, el asistente y las alertas.
 *
 * Mirar el mapa es libre; abrir el recorrido de una línea o preguntarle al
 * asistente pide sesión.
 */
@Component({
  imports: [FormsModule, NgTemplateOutlet],
  selector: 'app-home',
  styleUrl: './home.css',
  templateUrl: './home.html',
})
export class Home implements OnDestroy {
  /** La línea abierta, tomada de la dirección `/ruta/<id>`; sin valor si se ven todas. */
  readonly id = input<string>();

  protected readonly store = inject(Store);
  private readonly api = inject(Api);
  private readonly ui = inject(Ui);
  private readonly sanitizer = inject(DomSanitizer);

  private readonly mapElement = viewChild.required<ElementRef<HTMLElement>>('map');

  protected readonly tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'lines', label: 'Rutas', icon: 'directions_bus' },
    { id: 'assistant', label: 'Asistente', icon: 'chat_bubble_outline' },
    { id: 'alerts', label: 'Alertas', icon: 'warning_amber' },
  ];
  protected readonly alertTypes = ALERT_TYPES;
  protected readonly alertLabel = alertLabel;
  protected readonly nearMeMeters = NEAR_ME_METERS;
  protected readonly ideas = [
    '¿Qué micro va a Huanchaco?',
    '¿Cuál es el pasaje más barato?',
    '¿Qué línea pasa por el centro?',
  ];
  protected readonly maxFavorites = MAX_FAVORITES;
  protected readonly routeTitle = routeTitle;
  protected readonly favoriteLabel = favoriteLabel;
  protected readonly walk = walk;

  /**
   * «Ida» o «Vuelta» de cada línea: las dos llevan el mismo nombre y la misma
   * foto, y sin esto parecen repetidas.
   */
  private readonly services = computed(() => groupServices(this.store.lines()));
  protected readonly directions = computed(
    () => new Map(this.services().flatMap((line) => line.routes.map((item) => [item.route, item.direction]))),
  );

  /** Los recorridos de la línea de cada ruta: su ida, su vuelta y sus variantes. */
  private readonly siblings = computed(
    () => new Map(this.services().flatMap((line) => line.routes.map((item) => [item.route, line.routes]))),
  );

  /** Para cambiar de sentido en la ficha: los recorridos de la línea abierta, si tiene más de uno. */
  protected readonly ways = computed(() => {
    const route = this.selected();
    const routes = route ? (this.siblings().get(route) ?? []) : [];
    return routes.length > 1 ? routes : [];
  });

  /** La ruta tiene ida y vuelta: en la lista sale una sola vez. */
  protected readonly roundTrip = (route: BusRoute): boolean => (this.siblings().get(route)?.length ?? 0) > 1;
  protected readonly safeUrl = safeUrl;

  /**
   * La foto de cada micro: la ida y la vuelta son el mismo micro, así que si
   * solo una tiene foto, la otra la toma prestada.
   */
  private readonly photos = computed(() => {
    const byName = new Map<string, string>();
    for (const route of this.store.lines()) {
      const photo = safeUrl(route.imageUrl);
      const key = route.name.trim().toLowerCase();
      if (photo !== null && !byName.has(key)) byName.set(key, photo);
    }
    return byName;
  });

  protected photoOf(route: BusRoute): string | null {
    return safeUrl(route.imageUrl) ?? this.photos().get(route.name.trim().toLowerCase()) ?? null;
  }

  protected readonly tab = signal<Tab>('lines');
  protected readonly lineFilter = signal<LineFilter>('all');

  /** El tipo de alerta que se está mirando; `null` para verlas todas. */
  protected readonly alertType = signal<string | null>(null);
  protected readonly search = signal('');

  /** Lo escrito en el buscador de micros de la lista: nombre, letra o empresa. */
  protected readonly lineQuery = signal('');

  /** Los lugares que sugiere el buscador del mapa mientras se escribe. */
  protected readonly suggestions = signal<PlaceSuggestion[]>([]);
  protected readonly suggesting = signal(false);

  /** La lista de sugerencias está abierta (el buscador tiene el foco). */
  protected readonly suggestOpen = signal(false);

  /** El sitio al que va quien escribió en el buscador, si sale en el mapa. */
  protected readonly destination = signal<Destination | null>(null);
  protected readonly searchingPlace = signal(false);

  /** El camino a pie hasta el paradero de la ruta abierta, por las calles. */
  protected readonly walkPath = signal<StreetPath | null>(null);

  /** La ventana para reportar una alerta desde la web. */
  protected readonly reporting = signal(false);
  protected readonly reportType = signal<string | null>(null);
  protected readonly reportPlace = signal('');
  protected readonly reportComment = signal('');

  /** La línea de micro de la que se habla en la alerta; vacío si ninguna. */
  protected readonly reportRoute = signal('');

  /**
   * Las líneas para elegir al reportar: una por línea (no la ida y la vuelta
   * por separado), en orden natural (C-2 antes que C-10).
   */
  protected readonly reportLines = computed(() => {
    const seen = new Map<string, BusRoute>();
    for (const route of this.store.lines()) {
      const key = routeTitle(route).toLowerCase();
      if (!seen.has(key)) seen.set(key, route);
    }
    return [...seen.values()]
      .map((route) => ({ id: route.id, label: routeTitle(route) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es', { numeric: true, sensitivity: 'base' }));
  });
  protected readonly sendingReport = signal(false);
  protected readonly question = signal('');
  protected readonly messages = signal<Message[]>([]);
  protected readonly asking = signal(false);
  protected readonly voice = new AssistantVoice(
    (text) => {
      void this.ask(text);
    },
    (message) => this.ui.notify(message, 'plain'),
  );
  protected readonly alerts = signal<CityAlert[]>([]);
  protected readonly favorites = signal<FavoritePlace[]>(loadFavorites());
  protected readonly satellite = signal(false);
  protected readonly locating = signal(false);

  /** Dónde está quien mira el mapa, si lo ha preguntado. */
  protected readonly me = signal<Fix | null>(null);

  /** El sitio que alguien marcó tocando el mapa, para ver su calle. */
  protected readonly pin = signal<GeoPoint | null>(null);

  /** El favorito que se está guardando: el próximo toque en el mapa marca dónde queda. */
  protected readonly savingKind = signal<FavoriteKind | null>(null);

  /** Casa, Trabajo y Otro, como en la app; los que ya están guardados no se ofrecen, salvo Otro. */
  protected readonly quickKinds = computed(() => {
    const used = new Set(this.favorites().map((place) => place.kind.code));
    return FAVORITE_KINDS.filter(
      (kind) => kind === OTHER_KIND || ((kind.code === 'HOME' || kind.code === 'WORK') && !used.has(kind.code)),
    );
  });

  /** La ventana que pregunta qué lugar es el que se va a guardar. */
  protected readonly choosingFavorite = signal(false);
  protected readonly favoriteKind = signal<FavoriteKind | null>(null);
  protected readonly favoriteName = signal('');

  protected readonly base = computed(() => (this.satellite() ? SATELLITE : STREETS));

  /** Se sabe dónde está quien mira: sin eso no se abre ninguna ruta. */
  private readonly located = computed(() => this.me() !== null);

  protected readonly selected = computed(() => {
    const id = this.id();
    if (id === undefined || !this.located()) return null;
    return this.store.lines().find((route) => route.id === id) ?? null;
  });

  private readonly colors = computed(
    () => new Map(this.store.lines().map((route, index) => [route, LINE_COLORS[index % LINE_COLORS.length]])),
  );

  /**
   * Las líneas ya convertidas: con el catálogo de una ciudad son miles de
   * puntos, y rehacerlas en cada repintado frena el mapa.
   */
  private readonly linePoints = computed(
    () =>
      new Map(
        this.store.lines().map((route) => {
          // Sin trazado dibujado, la línea une los puntos de referencia.
          const points: GeoPoint[] = route.path.length >= 2 ? route.path : route.stops;
          return [route, points];
        }),
      ),
  );

  protected readonly visible = computed(() => {
    const query = this.lineQuery().trim().toLowerCase();
    return this.store
      .lines()
      .filter((route) =>
        [
          route.name,
          route.vehicleName,
          route.origin,
          route.destination,
          route.letter,
          ...route.stops.map((stop) => stop.name),
        ]
          .join(' ')
          .toLowerCase()
          .includes(query),
      );
  });

  /**
   * Las rutas de la lista elegida, una por línea: la ida y la vuelta son el
   * mismo micro. Con «Cerca de ti», solo las que pasan cerca, la más cercana
   * primero, y de cada línea el sentido que pasa más cerca.
   */
  protected readonly rows = computed<LineRow[]>(() => {
    const me = this.me();
    const all =
      this.lineFilter() === 'all' || me === null
        ? this.visible().map((route): LineRow => ({ route, meters: null }))
        : this.visible()
            .map((route) => ({ route, meters: metersToLine(me, this.linePoints().get(route) ?? []) }))
            .filter((row) => row.meters <= NEAR_ME_METERS)
            .sort((a, b) => a.meters - b.meters);
    const seen = new Set<string>();
    return all.filter((row) => {
      const key = serviceKey(row.route);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

  /** Cuántas líneas hay con lo escrito en el buscador, contando la ida y la vuelta como una. */
  protected readonly lineCount = computed(() => new Set(this.visible().map(serviceKey)).size);

  /** Con «Cerca de ti» las rutas van de 5 en 5: la página que se ve, empezando en 0. */
  protected readonly nearPage = signal(0);

  /** Hay que paginar: la lista «Cerca de ti» con más de 5 rutas. */
  protected readonly pagingRows = computed(() => this.lineFilter() === 'near' && this.me() !== null);

  protected readonly rowsPager = computed(() => pagerOf(this.rows().length, this.nearPage()));

  /** Las filas que se ven: todas, o las 5 de la página con «Cerca de ti». */
  protected readonly shownRows = computed(() => {
    if (!this.pagingRows()) return this.rows();
    const { from, to } = this.rowsPager();
    return this.rows().slice(from, to);
  });

  /** Al cambiar de lista se vuelve a las 5 primeras. */
  private readonly resetPages = effect(() => {
    this.lineFilter();
    untracked(() => this.nearPage.set(0));
  });

  /** El paradero de la ruta abierta más cercano a quien mira, si se sabe dónde está. */
  protected readonly boarding = computed(() => {
    const route = this.selected();
    const me = this.me();
    if (route === null || me === null || route.stops.length === 0) return null;
    let best = { index: 0, meters: Infinity };
    route.stops.forEach((stop, index) => {
      const meters = spotOnLine(me, [stop]).meters;
      if (meters < best.meters) best = { index, meters };
    });
    return { ...best, stop: route.stops[best.index] };
  });

  /** Las alertas del tipo elegido. */
  protected readonly shownAlerts = computed(() => {
    const type = this.alertType();
    return type === null ? this.alerts() : this.alerts().filter((alert) => alert.type === type);
  });

  /**
   * A dónde quiere llegar quien mira: el sitio buscado o, si no buscó nada, el
   * punto que marcó en el mapa. Mientras se busca un sitio no hay ninguno.
   */
  protected readonly target = computed<(GeoPoint & { name: string }) | null>(() => {
    const place = this.destination();
    if (place !== null) return place;
    const pin = this.pin();
    if (pin === null || this.searchingPlace()) return null;
    return { latitude: pin.latitude, longitude: pin.longitude, name: 'el punto marcado' };
  });

  protected readonly pinIsDestination = computed(() => {
    const pin = this.pin();
    const place = this.destination();
    return pin !== null && place !== null && place.latitude === pin.latitude && place.longitude === pin.longitude;
  });

  protected readonly pinIsFavorite = computed(() => {
    const pin = this.pin();
    return (
      pin !== null &&
      this.favorites().some((place) => place.latitude === pin.latitude && place.longitude === pin.longitude)
    );
  });

  /** Los tipos de lugar que se pueden elegir: los que ya tienen favorito no se ofrecen otra vez, salvo "otro". */
  protected readonly freeKinds = computed(() => {
    const used = new Set(this.favorites().map((place) => place.kind));
    return FAVORITE_KINDS.filter((kind) => kind === OTHER_KIND || !used.has(kind));
  });

  // --- Cómo llegar con transbordo y cuánto cuesta ---

  protected readonly riders = RIDERS;
  protected readonly formatSoles = formatSoles;

  /** El pasaje que paga quien mira: el general, el universitario o el escolar. Se recuerda en este navegador. */
  protected readonly rider = signal<Rider>(RIDERS.find((item) => item.code === load(RIDER_KEY))?.code ?? 'general');

  protected chooseRider(rider: Rider): void {
    this.rider.set(rider);
    save(RIDER_KEY, rider === 'general' ? null : rider);
  }

  /** Lo que cuestan los micros de un viaje con el pasaje elegido. */
  protected fareOf(routes: BusRoute[]): number {
    return totalFare(routes, this.rider());
  }

  /**
   * Las formas de llegar desde donde está quien mira hasta el sitio elegido,
   * con uno o con dos micros, la más rápida primero.
   */
  protected readonly trips = computed<Journey[]>(() => {
    const place = this.target();
    const me = this.me();
    if (place === null || me === null) return [];
    // La ida y la vuelta de una línea pueden dar el mismo viaje: se enseña una vez.
    const seen = new Set<string>();
    return planJourneys(me, place, this.store.lines()).filter((trip) => {
      const key = trip.rides.map((ride) => `${serviceKey(ride.route)}>${ride.from.name}>${ride.to.name}`).join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

  /** El nombre de un paradero para leerlo: sin «Salida:», «Llegada:» ni el número de los repetidos. */
  protected stopLabel(name: string): string {
    return name.replace(/^(Salida|Llegada): /, '').replace(/ \(\d+\)$/, '');
  }

  /** El viaje elegido, que es lo único que se ve en el mapa: los tramos que se van en micro y lo que se camina. */
  protected readonly chosenJourney = signal<Journey | null>(null);

  /** Lo que costaría ir en taxi desde donde está quien mira hasta el sitio buscado. */
  protected readonly taxi = computed(() => {
    const me = this.me();
    const place = this.target();
    return me === null || place === null ? null : taxiEstimate(distance(me, place));
  });

  protected routesOf(journey: Journey): BusRoute[] {
    return journey.rides.map((ride) => ride.route);
  }

  /** Dibuja el viaje en el mapa y lo encuadra entero. */
  protected showJourney(journey: Journey): void {
    // Con una ruta abierta se vería su recorrido entero: se cierra.
    if (this.id() !== undefined) this.store.selectLine(null);
    this.chosenJourney.set(journey);
    const points = [this.me(), this.target(), ...journey.rides.flatMap((ride) => ride.line)].filter(
      (point): point is GeoPoint => point !== null,
    );
    if (this.map === undefined || points.length < 2) return;
    this.map.flyToBounds(L.latLngBounds(points.map(latLng)), { padding: [60, 60], duration: 0.45 });
  }

  // --- Por dónde pasa ---

  /** Cuántos puntos del recorrido se ven antes de desplegar la lista. */
  protected readonly stopsShown = 8;

  /** La lista de «Por dónde pasa» está desplegada entera. Se pliega al abrir otra ruta. */
  protected readonly stopsOpen = signal(false);
  private readonly foldStops = effect(() => {
    this.selected();
    this.stopsOpen.set(false);
  });

  protected readonly shownStops = computed(() => {
    const stops = this.selected()?.stops ?? [];
    return this.stopsOpen() ? stops : stops.slice(0, this.stopsShown);
  });

  // --- Viajar más seguro ---

  /** La placa del micro, para mandarla junto con la ruta. */
  protected readonly plate = signal('');

  /** Las alertas de zona peligrosa que caen sobre el recorrido de la ruta abierta. */
  protected readonly dangerOnRoute = computed(() => {
    const route = this.selected();
    if (route === null) return [];
    const line = this.linePoints().get(route) ?? [];
    return this.alerts().filter((alert) => alert.type === 'DANGER' && metersToLine(alert, line) <= DANGER_NEAR_METERS);
  });

  /** Manda por WhatsApp a quien se elija qué micro se tomó, su placa y dónde se está. */
  protected shareTrip(route: BusRoute): void {
    const way = this.directions().get(route);
    const plate = this.plate().trim().toUpperCase();
    const me = this.me();
    const lines = [
      `Voy en el micro ${routeTitle(route)}${way ? ` (${way.toLowerCase()})` : ''}: ${route.origin} → ${route.destination}.`,
      plate ? `Placa: ${plate}.` : '',
      me ? `Estoy aquí: https://maps.google.com/?q=${me.latitude.toFixed(6)},${me.longitude.toFixed(6)}` : '',
      route.id ? `Ruta: ${location.origin}/ruta/${route.id}` : '',
    ];
    const text = lines.filter(Boolean).join('\n');
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  }

  protected readonly greeting = computed(() => {
    const name = this.store.session()?.name.trim().split(' ')[0] ?? '';
    return name === '' ? '' : `Hola, ${name} · `;
  });

  /** Lo que hay que andar hasta el paradero: por las calles si se sabe el camino, en línea recta si no. */
  protected readonly walkMeters = computed(() => {
    const board = this.boarding();
    if (board === null) return null;
    return this.walkPath()?.meters ?? board.meters;
  });

  /** Dónde se pone la alerta que se reporta: el sitio marcado, donde está quien mira o el centro del mapa. */
  protected reportSpot(): { point: GeoPoint; where: string } | null {
    const pin = this.pin();
    if (pin !== null) return { point: pin, where: 'En el sitio que marcaste en el mapa' };
    const me = this.me();
    if (me !== null) return { point: { latitude: me.latitude, longitude: me.longitude }, where: 'Donde estás ahora' };
    const center = this.map?.getCenter();
    if (center) return { point: { latitude: center.lat, longitude: center.lng }, where: 'En el centro del mapa' };
    return null;
  }

  /** Los minutos andando para [meters], al menos uno. */
  protected walkMinutes(meters: number): number {
    return Math.max(1, Math.round(meters / WALK_METERS_PER_MINUTE));
  }

  protected alertIcon(type: string): string {
    return ALERT_ICONS[type] ?? ALERT_ICONS['OTHER'];
  }

  /** «Cerca de ti» necesita saber dónde está quien mira: si no se sabe, se pregunta. */
  protected showNear(): void {
    this.lineFilter.set('near');
    if (this.me() === null) void this.locate();
  }

  /** Copia el enlace de la ruta abierta para mandarlo. */
  protected async share(): Promise<void> {
    try {
      await navigator.clipboard.writeText(location.href);
      this.ui.notify('Enlace copiado. Pégalo donde quieras compartirlo.', 'plain');
    } catch {
      this.ui.notify('No se pudo copiar el enlace. Cópialo de la barra de direcciones.', 'plain');
    }
  }

  // --- La hoja del celular: se arrastra entre tres alturas ---

  /** Cuánto mapa se ve encima de la hoja: mucho (hoja baja), la mitad o poco (hoja alta). */
  protected readonly sheet = signal<'low' | 'mid' | 'high'>('mid');

  /** Mientras se arrastra, la altura del mapa en píxeles; `null` si no. */
  private readonly dragHeight = signal<number | null>(null);
  private dragFrom: { y: number; height: number; moved: boolean } | null = null;

  // --- El ancho del panel en la computadora: se arrastra su borde izquierdo ---

  /** El ancho elegido en píxeles; `null` para el de siempre. Se recuerda en este navegador. */
  private readonly panelWidth = signal<number | null>(Number(load(PANEL_WIDTH_KEY)) || null);
  private resizeFrom: { x: number; width: number } | null = null;

  @HostBinding('style.--panel-w')
  protected get panelWidthCss(): string | null {
    const width = this.panelWidth();
    return width === null ? null : `${width}px`;
  }

  @HostBinding('class.resizing')
  protected get resizing(): boolean {
    return this.resizeFrom !== null;
  }

  protected resizeStart(event: PointerEvent): void {
    const panel = (event.currentTarget as HTMLElement).parentElement;
    if (panel === null) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.resizeFrom = { x: event.clientX, width: panel.getBoundingClientRect().width };
    event.preventDefault();
  }

  protected resizeMove(event: PointerEvent): void {
    const from = this.resizeFrom;
    if (from === null) return;
    // El panel está a la derecha: arrastrar hacia la izquierda lo ensancha.
    const total = this.host.nativeElement.clientWidth;
    const max = Math.max(PANEL_MIN_WIDTH, total - MAP_MIN_WIDTH);
    this.panelWidth.set(Math.round(Math.min(max, Math.max(PANEL_MIN_WIDTH, from.width + from.x - event.clientX))));
  }

  protected resizeEnd(): void {
    if (this.resizeFrom === null) return;
    this.resizeFrom = null;
    const width = this.panelWidth();
    save(PANEL_WIDTH_KEY, width === null ? null : String(width));
  }

  protected resetPanelWidth(): void {
    this.panelWidth.set(null);
    save(PANEL_WIDTH_KEY, null);
  }

  /** En la computadora el panel se esconde para ver el mapa entero. Se recuerda en este navegador. */
  protected readonly panelHidden = signal(load(PANEL_HIDDEN_KEY) === '1');

  /** Con la vista de calle abierta, el mapa le deja la mitad de su sitio. */
  @HostBinding('class.street-open')
  protected get streetOpen(): boolean {
    return this.streetPoint() !== null;
  }

  @HostBinding('class.panel-hidden')
  protected get panelHiddenClass(): boolean {
    return this.panelHidden();
  }

  protected togglePanel(): void {
    this.panelHidden.set(!this.panelHidden());
    save(PANEL_HIDDEN_KEY, this.panelHidden() ? '1' : null);
  }

  /** Abrir una ruta o buscar un sitio vuelve a mostrar el panel: ahí sale la respuesta. */
  private readonly revealPanel = effect(() => {
    if (this.selected() || this.destination() || this.searchingPlace()) {
      this.panelHidden.set(false);
      save(PANEL_HIDDEN_KEY, null);
    }
  });

  /** La altura del mapa en el celular, que lee el CSS. */
  @HostBinding('style.--map-h')
  protected get mapHeight(): string {
    const dragging = this.dragHeight();
    if (dragging !== null) return `${dragging}px`;
    return `${SHEET_MAP_SHARE[this.sheet()] * 100}%`;
  }

  @HostBinding('class.sheet-high')
  protected get sheetHigh(): boolean {
    return this.sheet() === 'high';
  }

  @HostBinding('class.dragging')
  protected get dragging(): boolean {
    return this.dragHeight() !== null;
  }

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected dragStart(event: PointerEvent): void {
    const map = this.host.nativeElement.querySelector<HTMLElement>('.map-area');
    if (map === null) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.dragFrom = { y: event.clientY, height: map.getBoundingClientRect().height, moved: false };
  }

  protected dragMove(event: PointerEvent): void {
    const from = this.dragFrom;
    if (from === null) return;
    const shift = event.clientY - from.y;
    if (!from.moved && Math.abs(shift) < 6) return;
    from.moved = true;
    const total = this.host.nativeElement.clientHeight;
    this.dragHeight.set(Math.min(total * 0.85, Math.max(total * 0.08, from.height + shift)));
  }

  protected dragEnd(event: PointerEvent): void {
    const from = this.dragFrom;
    this.dragFrom = null;
    if (from === null) return;
    const height = this.dragHeight();
    this.dragHeight.set(null);
    if (!from.moved || height === null) {
      // Un toque, sin arrastrar: sube la hoja o, si ya está arriba, la baja.
      this.toggleSheet();
      return;
    }
    // Se queda en la altura más cercana a donde se soltó.
    const share = height / this.host.nativeElement.clientHeight;
    const nearest = (Object.keys(SHEET_MAP_SHARE) as ('low' | 'mid' | 'high')[]).reduce((best, key) =>
      Math.abs(SHEET_MAP_SHARE[key] - share) < Math.abs(SHEET_MAP_SHARE[best] - share) ? key : best,
    );
    this.setSheet(nearest);
    event.preventDefault();
  }

  /** La altura de la hoja antes de abrir el asistente, para dejarla igual al salir. */
  private sheetBeforeChat: 'low' | 'mid' | 'high' | null = null;

  protected toggleSheet(): void {
    this.setSheet(this.sheet() === 'high' ? 'low' : this.sheet() === 'mid' ? 'high' : 'mid');
  }

  private setSheet(sheet: 'low' | 'mid' | 'high'): void {
    this.sheet.set(sheet);
  }

  // --- El mapa ---

  private map?: L.Map;
  private resize?: ResizeObserver;
  private readonly ready = signal(false);
  private tiles?: L.TileLayer;
  private readonly lineLayer = L.layerGroup();
  private readonly markerLayer = L.layerGroup();
  private readonly walkLayer = L.layerGroup();

  /** El nombre del lugar elegido: al ponerlo en el buscador no se vuelve a sugerir. */
  private chosenName: string | null = null;
  private framed = false;

  /** La línea que se está abriendo viene del asistente: la pestaña no cambia. */
  private keepChat = false;
  private locationAsked = false;

  constructor() {
    void this.loadAlerts();

    afterNextRender(() => {
      const map = L.map(this.mapElement().nativeElement, {
        center: TRUJILLO,
        zoom: CITY_ZOOM,
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        zoomSnap: 0.5,
        zoomControl: false,
        attributionControl: false,
        // Con más de cien líneas, un lienzo va mucho más suelto que un SVG.
        renderer: L.canvas({ tolerance: 6 }),
      });
      L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map);
      this.lineLayer.addTo(map);
      this.walkLayer.addTo(map);
      this.markerLayer.addTo(map);
      map.on('click', (event) => this.onMapClick({ latitude: event.latlng.lat, longitude: event.latlng.lng }));
      this.map = map;
      // Al subir o bajar la hoja el mapa cambia de alto, y Leaflet tiene que volver a medirse.
      this.resize = new ResizeObserver(() => map.invalidateSize());
      this.resize.observe(this.mapElement().nativeElement);
      this.ready.set(true);
    });

    effect(() => {
      if (!this.ready()) return;
      const base = this.base();
      // Al cambiar de fondo no se aprovecha nada del anterior.
      this.tiles?.remove();
      this.tiles = L.tileLayer(base.url, {
        maxNativeZoom: base.maxNativeZoom,
        maxZoom: MAX_ZOOM,
      }).addTo(this.map!);
      this.tiles.bringToBack();
    });

    effect(() => {
      if (this.ready()) this.drawLines();
    });

    // Otro sitio buscado o marcado, o quien mira se movió: el viaje que se veía ya no vale.
    effect(() => {
      this.trips();
      this.chosenJourney.set(null);
    });

    // Para decir cómo llegar hay que saber desde dónde: al elegir un sitio se pide la ubicación.
    effect(() => {
      if (this.target() === null || this.located()) return;
      untracked(() => void this.whereAmI());
    });

    effect(() => {
      if (this.ready()) this.drawMarkers();
    });

    effect(() => {
      if (this.ready()) this.drawWalk();
    });

    // Al abrir o cerrar una línea, o al llegar el catálogo, el mapa la encuadra.
    // Sin línea abierta se ve la ciudad: con todas, el mapa quedaría muy lejos.
    effect(() => {
      this.id();
      this.store.lines();
      this.located();
      if (!this.ready()) return;
      untracked(() => {
        if (this.selected() !== null) this.frame(this.framed);
        else if (this.framed) this.map?.flyTo(TRUJILLO, CITY_ZOOM, { duration: 0.45 });
        else this.map?.setView(TRUJILLO, CITY_ZOOM, { animate: false });
        this.framed = true;
      });
    });

    // Abrir una línea enseña su ficha, salvo desde el asistente: ahí la
    // conversación sigue a la vista y la línea se ve en el mapa.
    effect(() => {
      if (this.id() === undefined) return;
      untracked(() => {
        if (!this.keepChat) this.tab.set('lines');
        this.keepChat = false;
      });
    });

    // Una ruta solo se enseña sabiendo dónde está quien mira: si no se sabe,
    // se le pide su ubicación y, si no la da, se vuelve al mapa.
    effect(() => {
      const id = this.id();
      if (id === undefined || this.located()) return;
      untracked(() => void this.askLocationFor(id));
    });

    // Mientras se escribe en el buscador del mapa se sugieren lugares, como en
    // la app: así se elige el sitio correcto en vez de adivinarlo por el nombre.
    effect((onCleanup) => {
      const query = this.search().trim();
      if (query === this.chosenName) return;
      this.chosenName = null;
      this.destination.set(null);
      this.searchingPlace.set(false);
      this.suggestions.set([]);
      this.suggesting.set(query.length >= 2);
      if (query.length < 2) return;
      let current = true;
      const timer = setTimeout(async () => {
        const places = await suggestPlaces(query, untracked(this.me));
        if (!current) return;
        this.suggesting.set(false);
        this.suggestions.set(places ?? []);
      }, SEARCH_PAUSE_MS);
      onCleanup(() => {
        current = false;
        clearTimeout(timer);
      });
    });

    // El camino a pie hasta el paradero, por las calles, como en la app.
    effect((onCleanup) => {
      const board = this.boarding();
      const me = this.me();
      this.walkPath.set(null);
      if (board === null || me === null) return;
      let current = true;
      void walkingPath(me, board.stop).then((path) => {
        if (current) this.walkPath.set(path);
      });
      onCleanup(() => (current = false));
    });

    // En el celular, el asistente es una pantalla más: la hoja sube del todo.
    effect(() => {
      const chatting = this.tab() === 'assistant';
      untracked(() => {
        if (!chatting) this.voice.stop();
        if (chatting && this.sheetBeforeChat === null) {
          this.sheetBeforeChat = this.sheet();
          this.setSheet('high');
        } else if (!chatting && this.sheetBeforeChat !== null) {
          this.setSheet(this.sheetBeforeChat);
          this.sheetBeforeChat = null;
        }
      });
    });

    // Al salir de la cuenta, la conversación se va con ella.
    effect(() => {
      if (this.store.session() === null) {
        this.messages.set([]);
        this.voice.stop();
      }
    });
  }

  ngOnDestroy(): void {
    this.voice.stop();
    this.resize?.disconnect();
    this.map?.remove();
  }

  private async loadAlerts(): Promise<void> {
    try {
      this.alerts.set(await this.api.alerts());
    } catch {
      // Las alertas son un extra: sin ellas el mapa sigue sirviendo.
    }
  }

  /** Quita de la vista una foto que no se pudo cargar. */
  protected hide(event: Event): void {
    (event.target as HTMLElement).hidden = true;
  }

  protected colorOf(route: BusRoute): string {
    return this.colors().get(route) ?? LINE_COLORS[0];
  }

  /** Como en la app, en el mapa solo se ve la línea que se eligió; sin elegir ninguna, ninguna. */
  private drawLines(): void {
    const selected = this.selected();
    this.lineLayer.clearLayers();
    // Sin línea abierta, el viaje con transbordo elegido: cada micro en su color.
    const journey = this.chosenJourney();
    if (selected === null && journey !== null) {
      for (const ride of journey.rides) this.drawLine(ride.route, ride.line.map(latLng));
      // Lo que se camina: hasta el primer micro, entre micros y desde el último hasta el sitio.
      const stops = [this.me(), ...journey.rides.flatMap((ride) => [ride.from, ride.to]), this.target()];
      for (let i = 0; i + 1 < stops.length; i += 2) {
        const [from, to] = [stops[i], stops[i + 1]];
        if (from === null || to === null || distance(from, to) < 10) continue;
        const line = [latLng(from), latLng(to)];
        L.polyline(line, { weight: 8, color: '#fff', opacity: 0.9, interactive: false }).addTo(this.lineLayer);
        L.polyline(line, { weight: 5, color: MAP_BLUE, opacity: 1, dashArray: '2 9' })
          .bindTooltip(mapTip(`Camina ${walk(distance(from, to))}`), { sticky: true, className: 'line-tip' })
          .addTo(this.lineLayer);
      }
      return;
    }
    if (selected === null) return;
    // Las zonas peligrosas reportadas sobre el recorrido, en rojo debajo de la línea.
    for (const alert of this.dangerOnRoute()) {
      L.circle(latLng(alert), {
        radius: DANGER_NEAR_METERS,
        color: '#d93025',
        weight: 1,
        opacity: 0.6,
        fillOpacity: 0.15,
        interactive: false,
      }).addTo(this.lineLayer);
    }
    this.drawLine(selected, (this.linePoints().get(selected) ?? []).map(latLng));
  }

  private drawLine(route: BusRoute, points: L.LatLngTuple[]): void {
    if (points.length < 2) return;
    // Como en la app: la línea en su color, con un borde blanco que la separa de las calles.
    L.polyline(points, { weight: 10, color: '#fff', opacity: 1, interactive: false }).addTo(this.lineLayer);
    L.polyline(points, { weight: 6, color: this.colorOf(route), opacity: 1 })
      .bindTooltip(mapTip(routeTitle(route)), {
        sticky: true,
        className: 'line-tip',
        direction: 'right',
        offset: [12, 12],
      })
      .addTo(this.lineLayer);
  }

  /** La guía a pie: puntos azules desde quien mira hasta su paradero, como en Google Maps. */
  private drawWalk(): void {
    this.walkLayer.clearLayers();
    const board = this.boarding();
    const me = this.me();
    if (board === null || me === null) return;
    const path = this.walkPath()?.points ?? [];
    // El camino empieza y acaba en la calle más cercana: se une con quien mira y con el paradero.
    const line = [me, ...path, board.stop].map(latLng);
    L.polyline(line, { weight: 8, color: '#fff', opacity: 0.9, interactive: false }).addTo(this.walkLayer);
    L.polyline(line, { weight: 5, color: MAP_BLUE, opacity: 1, dashArray: '2 9' })
      .bindTooltip(mapTip(`Camina ${walk(this.walkMeters() ?? board.meters)} hasta ${board.stop.name}`), {
        sticky: true,
        className: 'line-tip',
      })
      .addTo(this.walkLayer);
  }

  /** Enseña en el mapa el camino a pie desde quien mira hasta el paradero. */
  protected showWalk(): void {
    const board = this.boarding();
    const me = this.me();
    if (board === null || me === null || this.map === undefined) return;
    const points = [me, board.stop, ...(this.walkPath()?.points ?? [])].map(latLng);
    this.map.flyToBounds(L.latLngBounds(points), { padding: [80, 80], maxZoom: 18, duration: 0.45 });
  }

  private drawMarkers(): void {
    const selected = this.selected();
    this.markerLayer.clearLayers();
    const meIcon = badge('mk-me', '', 20);
    const pinIcon = badge('mk-pin mi', 'location_on', 36);
    const add = (point: GeoPoint, icon: L.DivIcon, title: string, onClick?: () => void) => {
      const marker = L.marker(latLng(point), {
        icon,
        title,
        keyboard: false,
        // El alfiler y «estás aquí» van por encima de las letras de las líneas.
        zIndexOffset: icon === pinIcon || icon === meIcon ? 1000 : 0,
      });
      if (onClick) marker.on('click', onClick);
      marker.addTo(this.markerLayer);
    };

    for (const alert of this.alerts()) {
      add(
        alert,
        badge(`mk-alert mi t-${alert.type.toLowerCase()}`, this.alertIcon(alert.type)),
        [alert.label, alert.placeName].filter(Boolean).join(' · '),
      );
    }
    if (selected !== null) {
      const color = this.colorOf(selected);
      const last = selected.stops.length - 1;
      selected.stops.forEach((stop, index) => {
        // La salida lleva la insignia de la ruta; la llegada, el punto amarillo; los demás, un círculo en su color.
        if (index === 0) add(stop, badge('mk-letter', selected.letter || '·', 30, color), stop.name);
        else if (index === last) add(stop, badge('mk-stop end', '', 20), stop.name);
        else add(stop, badge('mk-stop', '', 16, color), stop.name);
      });
    }
    const journey = this.chosenJourney();
    if (selected === null && journey !== null) {
      // Dónde se sube a cada micro, con su letra, y dónde se baja.
      for (const ride of journey.rides) {
        const color = this.colorOf(ride.route);
        add(ride.from, badge('mk-letter', ride.route.letter || '·', 30, color), `Sube aquí: ${this.stopLabel(ride.from.name)}`);
        add(ride.to, badge('mk-stop', '', 16, color), `Baja aquí: ${this.stopLabel(ride.to.name)}`);
      }
    }
    for (const place of this.favorites()) {
      add(place, badge('mk-favorite mi', place.kind.icon), favoriteLabel(place), () => this.showFavorite(place));
    }

    const me = this.me();
    if (me !== null) {
      // El margen de error de la ubicación. Con uno muy grande (un ordenador
      // sin GPS) el círculo taparía media ciudad.
      if (me.accuracy < 1500) {
        L.circle(latLng(me), {
          radius: me.accuracy,
          color: MAP_BLUE,
          weight: 1,
          opacity: 0.45,
          fillOpacity: 0.12,
          interactive: false,
        }).addTo(this.markerLayer);
      }
      add(me, meIcon, 'Estás aquí');
    }

    const pin = this.pin();
    if (pin !== null) {
      // La punta del alfiler, no su centro, señala el sitio.
      pinIcon.options.iconAnchor = [18, 34];
      add(pin, pinIcon, 'Quitar la marca', () => this.pin.set(null));
    }
  }

  /** Encuadra la línea abierta o, si no hay, todas. */
  protected frame(animate = true): void {
    const selected = this.selected();
    const points = (selected === null ? this.store.lines() : [selected]).flatMap(
      (route) => this.linePoints().get(route) ?? [],
    );
    if (this.map === undefined || points.length < 2) return;
    const bounds = L.latLngBounds(points.map(latLng));
    // El mapa nace ya encuadrado; después, se desliza hasta el encuadre.
    if (animate) this.map.flyToBounds(bounds, { padding: [48, 48], duration: 0.45 });
    else this.map.fitBounds(bounds, { padding: [48, 48], animate: false });
    this.framed = true;
  }

  /** Lleva el mapa a [point], deslizándolo, sin alejarlo si ya estaba más cerca. */
  protected glideTo(point: GeoPoint, zoom: number): void {
    this.map?.flyTo(latLng(point), zoom, { duration: 0.45 });
  }

  protected zoom(change: number): void {
    this.map?.setZoom(this.map.getZoom() + change);
  }

  /** Lleva el mapa a donde está quien lo mira, si deja saberlo. */
  protected async locate(): Promise<void> {
    if (this.locating()) return;
    this.locating.set(true);
    const fix = await currentLocation();
    this.locating.set(false);
    if (fix === null) {
      this.ui.notify('No se pudo saber dónde estás. Revisa que el navegador tenga permiso de ubicación.', 'plain');
      return;
    }
    this.me.set(fix);
    this.glideTo(fix, Math.max(16, this.map?.getZoom() ?? 16));
  }

  /**
   * Abre la vista de calle de Google Maps en el sitio marcado o, sin marca, en
   * el centro del mapa. Es un enlace: no pide clave ni cuenta de Google.
   */
  /**
   * El sitio cuya calle se ve en el panel de al lado del mapa, como en la app;
   * `null` con el panel cerrado. Mientras está abierto, tocar el mapa lo cambia.
   */
  protected readonly streetPoint = signal<GeoPoint | null>(null);

  /**
   * La vista de calle de Google en su versión para insertar: no pide clave ni
   * cuenta. La página normal de Google Maps no se deja meter en otra web.
   */
  protected readonly streetUrl = computed<SafeResourceUrl | null>(() => {
    const point = this.streetPoint();
    if (point === null) return null;
    const spot = `${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}`;
    return this.sanitizer.bypassSecurityTrustResourceUrl(
      `https://maps.google.com/maps?q=&layer=c&cbll=${spot}&cbp=11,0,0,0,0&output=svembed`,
    );
  });

  protected openStreetView(): void {
    const center = this.map?.getCenter();
    const point = this.pin() ?? (center ? { latitude: center.lat, longitude: center.lng } : null);
    if (point === null) return;
    this.pin.set(point);
    void this.showStreet(point);
  }

  /**
   * Enseña la calle de [point]. Si se sabe que ahí no hay fotos, lo dice en un
   * aviso y no abre (ni cambia) el recuadro de la calle.
   */
  private async showStreet(point: GeoPoint): Promise<void> {
    if (!(await hasStreetPhotos(point))) {
      this.ui.notify('No hay fotos de la calle en este punto. Prueba tocando otra calle.', 'plain');
      return;
    }
    this.streetPoint.set(point);
  }

  // --- El buscador del mapa ---

  /** Elige un lugar de las sugerencias: lo marca y busca las rutas que llevan hasta él. */
  protected async choosePlace(place: PlaceSuggestion): Promise<void> {
    this.chosenName = place.name;
    this.search.set(place.name);
    this.suggestions.set([]);
    this.suggesting.set(false);
    this.suggestOpen.set(false);
    this.tab.set('lines');
    this.showDestination(place);
    await this.findDestination(place.name, place);
  }

  /** Con Intro sin elegir: la primera sugerencia o, si no hay, lo que diga el servidor por el nombre. */
  protected async searchPlace(): Promise<void> {
    const first = this.suggestions()[0];
    if (first) return this.choosePlace(first);
    const query = this.search().trim();
    if (query.length < 3) return;
    this.chosenName = query;
    this.suggestOpen.set(false);
    this.tab.set('lines');
    const destination = await this.findDestination(query, null);
    if (destination !== null) this.showDestination(destination);
  }

  private async findDestination(name: string, to: GeoPoint | null): Promise<Destination | null> {
    this.searchingPlace.set(true);
    this.destination.set(null);
    const destination = await this.api.destination(name, this.me(), to).catch(() => null);
    // Mientras tanto se escribió o se eligió otra cosa.
    if (this.chosenName !== name) return null;
    this.searchingPlace.set(false);
    this.destination.set(destination);
    if (destination === null) this.ui.notify('No se encontró ese lugar en el mapa. Prueba con otro nombre.', 'plain');
    return destination;
  }

  /** Pide la ubicación para enseñar la ruta [id]; sin ella, cierra la ruta y explica por qué. */
  private async askLocationFor(id: string): Promise<void> {
    if (this.locating()) return;
    this.locating.set(true);
    const fix = await currentLocation();
    this.locating.set(false);
    if (fix !== null) {
      this.me.set(fix);
      return;
    }
    // Mientras se preguntaba, se cerró o se cambió de ruta.
    if (this.id() !== id) return;
    this.ui.notify('Para ver la ruta, permite que el navegador use tu ubicación.', 'plain');
    this.store.selectLine(null);
  }

  /** Quita el sitio al que se quería llegar: el buscado o el punto marcado. */
  protected clearTarget(): void {
    if (this.destination() !== null || this.searchingPlace()) this.clearSearch();
    else this.pin.set(null);
  }

  /** Vacía el buscador del mapa y quita el lugar buscado. */
  protected clearSearch(): void {
    if (this.pinIsDestination()) this.pin.set(null);
    this.chosenName = null;
    this.search.set('');
    this.destination.set(null);
    this.searchingPlace.set(false);
    this.suggestions.set([]);
  }

  /** La lista se cierra un poco después de perder el foco, para que el toque en una sugerencia llegue. */
  protected closeSuggestions(): void {
    setTimeout(() => this.suggestOpen.set(false), 200);
  }

  // --- Reportar una alerta ---

  protected openReport(): void {
    if (this.store.session() === null) {
      this.store.openLogin();
      return;
    }
    this.reportType.set(null);
    this.reportPlace.set('');
    this.reportComment.set('');
    this.reportRoute.set('');
    this.reporting.set(true);
  }

  protected async sendReport(): Promise<void> {
    const type = this.reportType();
    const spot = this.reportSpot();
    if (type === null || spot === null || this.sendingReport()) return;
    this.sendingReport.set(true);
    try {
      const alert = await this.api.reportAlert({
        type,
        ...spot.point,
        placeName: this.reportPlace().trim() || null,
        comment: this.reportComment().trim() || null,
        routeId: this.reportRoute() || null,
      });
      this.reporting.set(false);
      this.alerts.update((alerts) => [alert, ...alerts.filter((other) => other.id !== alert.id)]);
      this.alertType.set(null);
      this.tab.set('alerts');
      this.glideTo(alert, 16);
      this.ui.notify('Gracias. Tu alerta ya se ve en el mapa.', 'plain');
    } catch (error) {
      this.ui.notify(messageOf(error, 'No se pudo publicar la alerta. Inténtalo de nuevo.'), 'plain');
      if (error instanceof ApiError && error.unauthorized) this.store.onError(error);
    } finally {
      this.sendingReport.set(false);
    }
  }

  // --- Favoritos ---

  /** Lleva el mapa al sitio buscado y lo deja marcado. */
  protected showDestination(place: GeoPoint): void {
    this.pin.set({ latitude: place.latitude, longitude: place.longitude });
    this.glideTo(place, 15);
  }

  /** Lleva el mapa a un favorito y lo deja marcado. */
  protected showFavorite(place: FavoritePlace): void {
    this.pin.set({ latitude: place.latitude, longitude: place.longitude });
    this.glideTo(place, 16);
  }

  protected removeFavorite(place: FavoritePlace): void {
    this.favorites.update((places) => places.filter((other) => other !== place));
    storeFavorites(this.favorites());
  }

  /** Un toque en el mapa: guarda el favorito que se estaba marcando o, si no, deja la marca. */
  private onMapClick(point: GeoPoint): void {
    const kind = this.savingKind();
    this.pin.set(point);
    if (this.streetPoint() !== null) void this.showStreet(point);
    if (kind === null) return;
    this.savingKind.set(null);
    if (kind === OTHER_KIND) {
      // «Otro» pregunta qué lugar es y su nombre.
      this.chooseFavorite();
      return;
    }
    this.favorites.update((places) => [...places, { ...point, kind, name: '' }]);
    storeFavorites(this.favorites());
    this.ui.notify(`${kind.label} guardado.`, 'plain');
  }

  /** Empieza a guardar un favorito: la hoja se baja para que se vea el mapa. */
  protected startSaving(kind: FavoriteKind): void {
    this.pin.set(null);
    this.savingKind.set(kind);
    this.setSheet('low');
  }

  /** Antes de guardar el sitio marcado se pregunta qué lugar es. */
  protected chooseFavorite(): void {
    this.favoriteKind.set(null);
    this.favoriteName.set('');
    this.choosingFavorite.set(true);
  }

  protected saveFavorite(): void {
    const pin = this.pin();
    const kind = this.favoriteKind();
    this.choosingFavorite.set(false);
    if (pin === null || kind === null || this.favorites().length >= MAX_FAVORITES) return;
    this.favorites.update((places) => [...places, { ...pin, kind, name: this.favoriteName().trim() }]);
    storeFavorites(this.favorites());
  }

  // --- Asistente ---

  protected async ask(preset?: string): Promise<void> {
    const question = (preset ?? this.question()).trim();
    if (question === '' || this.asking()) return;
    this.voice.stop();
    const history = this.messages()
      .filter((message) => !message.failed)
      .map(({ mine, text }) => ({ mine, text }));
    this.say({ text: question, mine: true, routes: [] });
    this.question.set('');
    this.asking.set(true);
    try {
      const answer = await this.api.ask(question, await this.whereAmI(), history);
      const routes = answer.routeIds.flatMap((id) => this.store.lines().find((candidate) => candidate.id === id) ?? []);
      this.say({ text: answer.text, mine: false, routes });
      if (this.tab() === 'assistant' && this.store.session() !== null) this.voice.speak(answer.text);
    } catch (error) {
      this.say({
        text: messageOf(error, 'El asistente no respondió. Inténtalo de nuevo.'),
        mine: false,
        routes: [],
        failed: true,
      });
      if (error instanceof ApiError && error.unauthorized) this.store.onError(error);
    } finally {
      this.asking.set(false);
    }
  }

  /**
   * Dónde está quien pregunta, para que el asistente parta de ahí. Al navegador
   * se le pregunta una vez: si no lo dice, no se insiste en cada pregunta.
   */
  private async whereAmI(): Promise<Fix | null> {
    if (this.me() !== null || this.locationAsked) return this.me();
    this.locationAsked = true;
    const fix = await currentLocation();
    if (fix !== null) this.me.set(fix);
    return fix;
  }

  /** Abre en el mapa la línea que recomendó el asistente, sin dejar la conversación. */
  protected showFromChat(route: BusRoute): void {
    if (this.selected() === route) {
      this.tab.set('lines');
      return;
    }
    // Sin sesión no se abre nada, y la marca no puede quedarse puesta.
    this.keepChat = this.store.session() !== null;
    this.store.selectLine(route.id);
  }

  private say(message: Message): void {
    this.messages.update((messages) => [...messages, message]);
  }
}

/** Qué parte de una lista larga se ve: de [from] a [to], en la página [page] de [pages]. */
export function pagerOf(total: number, wanted: number, size = NEAR_PAGE) {
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(0, wanted), pages - 1);
  const from = page * size;
  return { page, pages, from, to: Math.min(total, from + size), total };
}

/**
 * Si Google tiene fotos de la calle cerca de [point]. Sin clave, o si la
 * consulta falla, se da por hecho que sí: Google lo dice en su recuadro.
 */
async function hasStreetPhotos(point: GeoPoint): Promise<boolean> {
  if (SiteInfo.streetViewKey === '') return true;
  const query = new URLSearchParams({
    location: `${point.latitude},${point.longitude}`,
    radius: '50',
    source: 'outdoor',
    key: SiteInfo.streetViewKey,
  });
  try {
    const response = await fetch(`https://maps.googleapis.com/maps/api/streetview/metadata?${query}`);
    const data = (await response.json()) as { status?: string };
    return data.status !== 'ZERO_RESULTS';
  } catch {
    return true;
  }
}
