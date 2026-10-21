import {
  Component,
  ElementRef,
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
import { FormsModule } from '@angular/forms';
import * as L from 'leaflet';

import { Api } from '../../core/api';
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
  DestinationLine,
  GeoPoint,
  messageOf,
  routeTitle,
  safeUrl,
} from '../../core/models';
import { directionsOf } from '../../core/directions';
import { metersToLine, spotOnLine } from '../../core/nearby';
import { PlaceSuggestion, StreetPath, suggestPlaces, walkingPath } from '../../core/street';
import { Store } from '../../core/store';
import { Ui } from '../../core/ui';

type Tab = 'lines' | 'assistant' | 'alerts';

/** Las dos listas de rutas: las que pasan cerca de quien mira o todas. */
type LineFilter = 'near' | 'all';

/** Una ruta de la lista, con lo que hay que andar hasta ella si se sabe. */
interface LineRow {
  route: BusRoute;
  meters: number | null;
}

/** Los tipos de alerta, en el orden de la app, para filtrar la lista. */
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

const TRUJILLO: L.LatLngTuple = [-8.112, -79.0288];

// Más lejos que el mínimo ya no se distingue la ciudad.
const MIN_ZOOM = 10;
const MAX_ZOOM = 19;

/** Lo que se espera a que alguien deje de escribir antes de sugerirle lugares. */
const SEARCH_PAUSE_MS = 400;

/** Una distancia a pie, como se dice: «250 m» o «1,4 km». */
const walk = (meters: number): string =>
  meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1).replace('.', ',')} km`;

/** Hasta dónde se anda, más o menos, para coger un micro. */
const NEAR_METERS = 300;

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
  imports: [FormsModule],
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
  protected readonly nearMeters = NEAR_METERS;
  protected readonly maxFavorites = MAX_FAVORITES;
  protected readonly routeTitle = routeTitle;
  protected readonly favoriteLabel = favoriteLabel;
  protected readonly walk = walk;

  /**
   * «Ida» o «Vuelta» de cada línea: las dos llevan el mismo nombre y la misma
   * foto, y sin esto parecen repetidas.
   */
  protected readonly directions = computed(() => directionsOf(this.store.lines()));
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
  protected readonly sendingReport = signal(false);
  protected readonly question = signal('');
  protected readonly messages = signal<Message[]>([]);
  protected readonly asking = signal(false);
  protected readonly alerts = signal<CityAlert[]>([]);
  protected readonly favorites = signal<FavoritePlace[]>(loadFavorites());
  protected readonly satellite = signal(false);
  protected readonly locating = signal(false);

  /** Dónde está quien mira el mapa, si lo ha preguntado. */
  protected readonly me = signal<Fix | null>(null);

  /** El sitio que alguien marcó tocando el mapa, para ver su calle. */
  protected readonly pin = signal<GeoPoint | null>(null);

  /** La ventana que pregunta qué lugar es el que se va a guardar. */
  protected readonly choosingFavorite = signal(false);
  protected readonly favoriteKind = signal<FavoriteKind | null>(null);
  protected readonly favoriteName = signal('');

  protected readonly base = computed(() => (this.satellite() ? SATELLITE : STREETS));

  protected readonly selected = computed(() => {
    const id = this.id();
    return id === undefined ? null : (this.store.lines().find((route) => route.id === id) ?? null);
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

  /** Las líneas que llevan al sitio buscado, la mejor primero. */
  protected readonly reaching = computed(() =>
    (this.destination()?.lines ?? []).flatMap((line: DestinationLine) => {
      const route = this.store.lines().find((candidate) => candidate.id === line.routeId);
      return route === undefined ? [] : [{ ...line, route }];
    }),
  );

  /** Las rutas de la lista elegida: con «Cerca de ti», solo las que pasan cerca, la más cercana primero. */
  protected readonly rows = computed<LineRow[]>(() => {
    const me = this.me();
    if (this.lineFilter() === 'all' || me === null) return this.visible().map((route) => ({ route, meters: null }));
    return this.visible()
      .map((route) => ({ route, meters: metersToLine(me, this.linePoints().get(route) ?? []) }))
      .filter((row) => row.meters <= NEAR_ME_METERS)
      .sort((a, b) => a.meters - b.meters);
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

  /** Las líneas que pasan cerca del sitio marcado, la más cercana primero. */
  protected readonly near = computed(() => {
    const pin = this.pin();
    if (pin === null) return [];
    return this.store
      .lines()
      .map((route) => ({ route, meters: metersToLine(pin, this.linePoints().get(route) ?? []) }))
      .filter((entry) => entry.meters <= NEAR_METERS)
      .sort((a, b) => a.meters - b.meters)
      .map((entry) => entry.route);
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

  // --- El mapa ---

  private map?: L.Map;
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
        zoom: 12.5,
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
      map.on('click', (event) => this.pin.set({ latitude: event.latlng.lat, longitude: event.latlng.lng }));
      this.map = map;
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

    effect(() => {
      if (this.ready()) this.drawMarkers();
    });

    effect(() => {
      if (this.ready()) this.drawWalk();
    });

    // Al abrir o cerrar una línea, o al llegar el catálogo, el mapa la encuadra.
    effect(() => {
      this.id();
      this.store.lines();
      if (!this.ready()) return;
      untracked(() => this.frame(this.framed));
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

    // Al salir de la cuenta, la conversación se va con ella.
    effect(() => {
      if (this.store.session() === null) this.messages.set([]);
    });
  }

  ngOnDestroy(): void {
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
    if (selected === null) return;
    const points = (this.linePoints().get(selected) ?? []).map(latLng);
    if (points.length < 2) return;
    // Como en la app: la línea en su color, con un borde blanco que la separa de las calles.
    L.polyline(points, { weight: 10, color: '#fff', opacity: 1, interactive: false }).addTo(this.lineLayer);
    L.polyline(points, { weight: 6, color: this.colorOf(selected), opacity: 1 })
      .bindTooltip(routeTitle(selected), { sticky: true, className: 'line-tip', direction: 'right', offset: [12, 12] })
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
      .bindTooltip(`Camina ${walk(this.walkMeters() ?? board.meters)} hasta ${board.stop.name}`, {
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
  protected openStreetView(): void {
    const center = this.map?.getCenter();
    const point = this.pin() ?? (center ? { latitude: center.lat, longitude: center.lng } : null);
    if (point === null) return;
    const query = new URLSearchParams({
      api: '1',
      map_action: 'pano',
      viewpoint: `${point.latitude},${point.longitude}`,
    });
    window.open(`https://www.google.com/maps/@?${query}`, '_blank', 'noopener');
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
