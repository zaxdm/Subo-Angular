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
import { ApiError, BusRoute, CityAlert, GeoPoint, messageOf, routeTitle } from '../../core/models';
import { metersToLine } from '../../core/nearby';
import { Store } from '../../core/store';
import { Ui } from '../../core/ui';

type Tab = 'lines' | 'assistant' | 'alerts';

/** Un mensaje de la conversación con el asistente. */
interface Message {
  text: string;
  mine: boolean;

  /** La línea que recomienda, para abrirla con un toque. */
  route: BusRoute | null;
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

/** Hasta dónde se anda, más o menos, para coger un micro. */
const NEAR_METERS = 300;

/** Un color por línea, para distinguirlas en el mapa. */
const LINE_COLORS = ['#e0a800', '#1f7a8c', '#c8553d', '#5b5f97', '#2e7d4f', '#b5459b', '#3f6fd1', '#8a5a2b'];

const INK = '#1c1a14';
const MAP_BLUE = '#1a73e8';

/** El color de una línea que no es la abierta: apagado, mezclado con el gris del mapa. */
function dimmed(color: string): string {
  const grey = [0xe9, 0xe6, 0xdf];
  const mixed = [1, 3, 5].map((start, index) => {
    const channel = parseInt(color.slice(start, start + 2), 16);
    return Math.round(channel + (grey[index] - channel) * 0.72);
  });
  return `rgb(${mixed.join(' ')})`;
}

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

  protected readonly tab = signal<Tab>('lines');
  protected readonly search = signal('');
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
    return this.store.lines().filter((route) =>
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
    return name === '' ? '¿Qué micro tomas hoy?' : `Hola, ${name}. ¿Qué micro tomas hoy?`;
  });

  // --- El mapa ---

  private map?: L.Map;
  private readonly ready = signal(false);
  private tiles?: L.TileLayer;
  private readonly lineLayer = L.layerGroup();
  private readonly markerLayer = L.layerGroup();
  private framed = false;

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
      this.tiles = L.tileLayer(base.url, { maxNativeZoom: base.maxNativeZoom, maxZoom: MAX_ZOOM }).addTo(this.map!);
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
      untracked(() => {
        if (this.selected() !== null) this.tab.set('lines');
        this.frame(this.framed);
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

  protected colorOf(route: BusRoute): string {
    return this.colors().get(route) ?? LINE_COLORS[0];
  }

  private drawLines(): void {
    const selected = this.selected();
    this.lineLayer.clearLayers();
    // La abierta se pinta la última, encima de las demás.
    const routes = [...this.store.lines().filter((route) => route !== selected), ...(selected ? [selected] : [])];
    for (const route of routes) {
      const points = (this.linePoints().get(route) ?? []).map(latLng);
      if (points.length < 2) continue;
      const color = this.colorOf(route);
      const open = route === selected;
      const style: L.PolylineOptions = {
        weight: open ? 6 : 4,
        color: selected === null || open ? color : dimmed(color),
        opacity: 1,
      };
      if (open) L.polyline(points, { weight: 9, color: INK, opacity: 1, interactive: false }).addTo(this.lineLayer);
      const line = L.polyline(points, style).addTo(this.lineLayer);
      // Sobre una línea sale su nombre, y se resalta para distinguirla de las de al lado.
      line.bindTooltip(routeTitle(route), { sticky: true, className: 'line-tip', direction: 'right', offset: [12, 12] });
      if (!open) {
        line.on('mouseover', () => line.setStyle({ weight: 6, color }).bringToFront());
        line.on('mouseout', () => line.setStyle(style));
      }
    }
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
    } else {
      // Sin línea abierta, cada una lleva su letra donde empieza.
      for (const route of this.store.lines()) {
        if (route.stops.length === 0 || route.letter === '') continue;
        const icon = badge('mk-letter', route.letter, 28);
        (icon.options.html as HTMLElement).style.background = this.colorOf(route);
        add(route.stops[0], icon, routeTitle(route), () => this.store.selectLine(route.id));
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
      this.ui.notify(
        'No se pudo saber dónde estás. Revisa que el navegador tenga permiso de ubicación.',
        'plain',
      );
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
    this.say({ text: question, mine: true, route: null });
    this.question.set('');
    this.asking.set(true);
    try {
      const answer = await this.api.ask(question);
      const route = this.store.lines().find((candidate) => candidate.id === answer.routeId) ?? null;
      this.say({ text: answer.text, mine: false, route });
    } catch (error) {
      this.say({ text: messageOf(error, 'El asistente no respondió. Inténtalo de nuevo.'), mine: false, route: null });
      if (error instanceof ApiError && error.unauthorized) this.store.onError(error);
    } finally {
      this.asking.set(false);
    }
  }

  private say(message: Message): void {
    this.messages.update((messages) => [...messages, message]);
  }
}
