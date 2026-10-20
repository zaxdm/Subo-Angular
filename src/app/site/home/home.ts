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
import { metersToLine } from '../../core/nearby';
import { Store } from '../../core/store';
import { Ui } from '../../core/ui';

type Tab = 'lines' | 'assistant' | 'alerts';

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

/** Lo que se espera a que alguien deje de escribir antes de buscar a dónde va. */
const SEARCH_PAUSE_MS = 600;

/** Una distancia a pie, como se dice: «250 m» o «1,4 km». */
const walk = (meters: number): string =>
  meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1).replace('.', ',')} km`;

/** Hasta dónde se anda, más o menos, para coger un micro. */
const NEAR_METERS = 300;

/** Un color por línea, para distinguirlas en el mapa. */
const LINE_COLORS = ['#e0a800', '#1f7a8c', '#c8553d', '#5b5f97', '#2e7d4f', '#b5459b', '#3f6fd1', '#8a5a2b'];

const INK = '#1c1a14';
const MAP_BLUE = '#1a73e8';

const latLng = (point: GeoPoint): L.LatLngTuple => [point.latitude, point.longitude];

/** Una marca del mapa hecha con HTML: un círculo con un texto o un icono dentro. */
function badge(className: string, text = '', size = 30): L.DivIcon {
  const element = document.createElement('div');
  element.className = `mk ${className}`;
  element.textContent = text;
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

  protected readonly tabs: { id: Tab; label: string }[] = [
    { id: 'lines', label: 'Líneas' },
    { id: 'assistant', label: 'Asistente' },
    { id: 'alerts', label: 'Alertas' },
  ];
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

  protected readonly tab = signal<Tab>('lines');
  protected readonly search = signal('');

  /** El sitio al que va quien escribió en el buscador, si sale en el mapa. */
  protected readonly destination = signal<Destination | null>(null);
  protected readonly searchingPlace = signal(false);
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
    const query = this.search().trim().toLowerCase();
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
    return name === '' ? '¿A dónde vas hoy?' : `Hola, ${name}. ¿A dónde vas hoy?`;
  });

  // --- El mapa ---

  private map?: L.Map;
  private readonly ready = signal(false);
  private tiles?: L.TileLayer;
  private readonly lineLayer = L.layerGroup();
  private readonly markerLayer = L.layerGroup();
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

    // Lo escrito en el buscador se busca también como un sitio del mapa, cuando
    // se deja de escribir: así «Tecsup» da las líneas que llevan hasta allí.
    effect((onCleanup) => {
      const query = this.search().trim();
      this.destination.set(null);
      this.searchingPlace.set(query.length >= 3);
      if (query.length < 3) return;
      let current = true;
      const timer = setTimeout(async () => {
        const destination = await this.api.destination(query, untracked(this.me)).catch(() => null);
        if (!current) return;
        this.searchingPlace.set(false);
        this.destination.set(destination);
        if (destination !== null) this.showDestination(destination);
      }, SEARCH_PAUSE_MS);
      onCleanup(() => {
        current = false;
        clearTimeout(timer);
      });
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
    L.polyline(points, { weight: 9, color: INK, opacity: 1, interactive: false }).addTo(this.lineLayer);
    L.polyline(points, { weight: 6, color: this.colorOf(selected), opacity: 1 })
      .bindTooltip(routeTitle(selected), { sticky: true, className: 'line-tip', direction: 'right', offset: [12, 12] })
      .addTo(this.lineLayer);
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
      add(alert, badge('mk-alert mi', 'warning_amber'), [alert.label, alert.placeName].filter(Boolean).join(' · '));
    }
    if (selected !== null) {
      selected.stops.forEach((stop, index) => {
        const end = index === 0 || index === selected.stops.length - 1;
        add(stop, badge(end ? 'mk-stop end' : 'mk-stop', '', 20), stop.name);
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
