import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import * as L from 'leaflet';

import { Api } from '../../core/api';
import {
  ApiError,
  BusRoute,
  GeoPoint,
  MAX_IMAGE_BYTES,
  ROUTE_STATUSES,
  RouteStatus,
  RouteStop,
  imageTypeOf,
  safeUrl,
} from '../../core/models';
import { traceStreets } from '../../core/route-tools';
import { Store } from '../../core/store';
import { Ui } from '../../core/ui';
import { RoutePhoto } from '../../shared/route-photo/route-photo';

/** Qué añade un clic en el mapa. */
type MapMode = 'stops' | 'path';

/** Los datos de la ruta que se escriben en un campo de texto. */
type Key =
  | 'name'
  | 'letter'
  | 'vehicleName'
  | 'origin'
  | 'destination'
  | 'fare'
  | 'duration'
  | 'fareSchool'
  | 'fareUniversity'
  | 'frequency'
  | 'schedule'
  | 'description'
  | 'imageUrl';

/** Un campo del formulario. */
interface Field {
  key: Key;
  label: string;
  hint?: string;

  /** Cuánto ancho quiere dentro de su fila. */
  flex?: number;
  maxLength?: number;

  /** Qué se puede escribir: solo dígitos, o dígitos con decimales. */
  only?: 'digits' | 'decimal';
  multiline?: boolean;
}

const MAX_STOPS = 300;
const MAX_PATH_POINTS = 20000;
const TRUJILLO: L.LatLngTuple = [-8.112, -79.0288];
const INK = '#15171c';

const latLng = (point: GeoPoint): L.LatLngTuple => [point.latitude, point.longitude];

/** El número que hay escrito en [text], con coma o con punto; `null` si no es un número. */
function parseNumber(text: string): number | null {
  const clean = text.trim().replace(',', '.');
  const value = Number(clean);
  return clean === '' || !isFinite(value) ? null : value;
}

const parseInteger = (text: string): number | null => (/^\d+$/.test(text.trim()) ? parseInt(text.trim(), 10) : null);

const money = (value: number | null): string => (value === null ? '' : value.toFixed(2));

/**
 * Crea o edita una ruta: los datos del micro, su foto, los puntos de
 * referencia en orden y, si hace falta, el recorrido exacto dibujado sobre el
 * mapa.
 */
@Component({
  imports: [RoutePhoto],
  selector: 'app-editor',
  styleUrl: './editor.css',
  templateUrl: './editor.html',
})
export class Editor implements OnInit, OnDestroy {
  /** Copia de trabajo: se puede modificar sin tocar el catálogo. */
  readonly route = input.required<BusRoute>();

  private readonly api = inject(Api);
  private readonly store = inject(Store);
  private readonly ui = inject(Ui);
  private readonly mapElement = viewChild.required<ElementRef<HTMLElement>>('map');

  protected readonly statuses = ROUTE_STATUSES;
  protected readonly modes: { id: MapMode; label: string }[] = [
    { id: 'stops', label: 'Añadir puntos de referencia' },
    { id: 'path', label: 'Dibujar recorrido' },
  ];

  /** Los datos del micro, fila a fila. */
  protected readonly rows: Field[][] = [
    [
      { key: 'name', label: 'Nombre de la ruta', flex: 3, maxLength: 80 },
      { key: 'letter', label: 'Letra', maxLength: 3 },
    ],
    [{ key: 'vehicleName', label: 'Nombre del micro o empresa', hint: 'Como lo conoce la gente', maxLength: 80 }],
    [
      { key: 'origin', label: 'Origen', maxLength: 80 },
      { key: 'destination', label: 'Destino', maxLength: 80 },
    ],
    [
      { key: 'fare', label: 'Pasaje (S/)', only: 'decimal' },
      { key: 'duration', label: 'Duración (min)', only: 'digits' },
    ],
    [
      { key: 'fareSchool', label: 'Pasaje escolar (S/)', hint: 'Opcional', only: 'decimal' },
      { key: 'fareUniversity', label: 'Pasaje universitario (S/)', hint: 'Opcional', only: 'decimal' },
      { key: 'frequency', label: 'Pasa cada (min)', hint: 'Opcional', only: 'digits' },
    ],
    [{ key: 'schedule', label: 'Horario', hint: '05:00 – 22:30', maxLength: 60 }],
    [
      {
        key: 'description',
        label: 'Descripción',
        hint: 'Por dónde pasa, cómo reconocerlo…',
        maxLength: 400,
        multiline: true,
      },
    ],
  ];

  protected readonly values = signal<Record<Key, string>>({
    name: '',
    letter: '',
    vehicleName: '',
    origin: '',
    destination: '',
    fare: '',
    duration: '',
    fareSchool: '',
    fareUniversity: '',
    frequency: '',
    schedule: '',
    description: '',
    imageUrl: '',
  });
  protected readonly status = signal<RouteStatus>('APPROVED');
  protected readonly bidirectional = signal(true);
  protected readonly stops = signal<RouteStop[]>([]);

  /** Trazado dibujado a mano; vacío si la app debe estimarlo entre puntos de referencia. */
  protected readonly path = signal<GeoPoint[]>([]);

  protected readonly mode = signal<MapMode>('stops');
  protected readonly busy = signal(false);
  protected readonly uploading = signal(false);
  protected readonly tracing = signal(false);
  private dirty = false;

  /** Ya se intentó guardar: los campos enseñan lo que les falta. */
  protected readonly checked = signal(false);

  protected readonly isNew = computed(() => this.route().id === null);
  protected readonly locked = computed(() => this.busy() || this.uploading() || this.tracing());
  protected readonly photoUrl = computed(() => safeUrl(this.values().imageUrl.trim()));

  /** Lo que le falta a cada campo; vacío si todo está bien. */
  protected readonly problems = computed(() => {
    const values = this.values();
    const problems: Partial<Record<Key, string>> = {};
    for (const key of ['name', 'letter', 'origin', 'destination'] as const) {
      if (values[key].trim() === '') problems[key] = 'Obligatorio';
    }
    const fare = parseNumber(values.fare);
    if (fare === null || fare <= 0 || fare > 50) problems.fare = 'Entre 0.10 y 50';
    if ((parseInteger(values.duration) ?? 0) <= 0) problems.duration = 'Mayor que 0';
    // Un pasaje reducido puede quedar vacío, pero nunca costar más que el regular.
    for (const key of ['fareSchool', 'fareUniversity'] as const) {
      if (values[key].trim() === '') continue;
      const reduced = parseNumber(values[key]);
      if (reduced === null || reduced <= 0 || reduced > (fare ?? 50)) problems[key] = 'No mayor que el regular';
    }
    if (values.frequency.trim() !== '') {
      const minutes = parseInteger(values.frequency) ?? 0;
      if (minutes <= 0 || minutes > 240) problems.frequency = 'Entre 1 y 240';
    }
    if (values.imageUrl.trim() !== '' && this.photoUrl() === null) {
      problems.imageUrl = 'Tiene que empezar por https://';
    }
    return problems;
  });

  // --- Mapa ---

  private map?: L.Map;
  private readonly ready = signal(false);
  private readonly lineLayer = L.layerGroup();
  private readonly markerLayer = L.layerGroup();

  constructor() {
    afterNextRender(() => {
      const stops = this.stops();
      const map = L.map(this.mapElement().nativeElement, {
        center: stops.length === 0 ? TRUJILLO : latLng(stops[0]),
        zoom: 13,
        maxZoom: 19,
        attributionControl: false,
      });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxNativeZoom: 19, maxZoom: 19 }).addTo(map);
      this.lineLayer.addTo(map);
      this.markerLayer.addTo(map);
      if (stops.length >= 2) map.fitBounds(L.latLngBounds(stops.map(latLng)), { padding: [40, 40], maxZoom: 15 });
      map.on('click', (event) => this.onMapClick(event.latlng));
      this.map = map;
      this.ready.set(true);
    });

    effect(() => {
      if (!this.ready()) return;
      this.drawLine();
      this.drawStops();
    });
  }

  ngOnInit(): void {
    const route = this.route();
    this.values.set({
      name: route.name,
      letter: route.letter,
      vehicleName: route.vehicleName,
      origin: route.origin,
      destination: route.destination,
      fare: route.fare > 0 ? route.fare.toFixed(2) : '',
      duration: route.durationMinutes > 0 ? String(route.durationMinutes) : '',
      fareSchool: money(route.fareSchool),
      fareUniversity: money(route.fareUniversity),
      frequency: route.frequencyMinutes === null ? '' : String(route.frequencyMinutes),
      schedule: route.schedule,
      description: route.description,
      imageUrl: route.imageUrl ?? '',
    });
    this.status.set(route.status);
    this.bidirectional.set(route.bidirectional);
    this.stops.set(route.stops);
    this.path.set(route.path);
  }

  ngOnDestroy(): void {
    this.map?.remove();
    // Una ruta a medio editar se queda esperando al volver de otra sección.
    if (this.store.editing() === this.route()) Object.assign(this.route(), this.snapshot());
  }

  /** La ruta tal como está ahora mismo en el formulario. */
  private snapshot(): BusRoute {
    const values = this.values();
    const imageUrl = values.imageUrl.trim();
    return {
      id: this.route().id,
      name: values.name,
      letter: values.letter,
      vehicleName: values.vehicleName,
      origin: values.origin,
      destination: values.destination,
      fare: parseNumber(values.fare) ?? 0,
      // Vacíos se mandan como "no se sabe": la app no los enseña.
      fareSchool: parseNumber(values.fareSchool),
      fareUniversity: parseNumber(values.fareUniversity),
      frequencyMinutes: parseInteger(values.frequency),
      durationMinutes: parseInteger(values.duration) ?? 0,
      schedule: values.schedule,
      description: values.description,
      imageUrl: imageUrl === '' ? null : imageUrl,
      bidirectional: this.bidirectional(),
      status: this.status(),
      stops: this.stops(),
      path: this.path(),
    };
  }

  protected setValue(field: Field | { key: Key; only?: undefined }, element: HTMLInputElement | HTMLTextAreaElement): void {
    let value = element.value;
    if (field.only === 'digits') value = value.replace(/\D/g, '');
    if (field.only === 'decimal') value = value.replace(/[^0-9.,]/g, '');
    element.value = value;
    this.values.update((values) => ({ ...values, [field.key]: value }));
    this.dirty = true;
  }

  protected setStatus(status: string): void {
    this.status.set(status as RouteStatus);
    this.dirty = true;
  }

  protected setBidirectional(value: boolean): void {
    this.bidirectional.set(value);
    this.dirty = true;
  }

  private onMapClick(point: L.LatLng): void {
    if (this.locked()) return;
    if (this.mode() === 'path') {
      if (this.path().length >= MAX_PATH_POINTS) return;
      this.path.update((path) => [...path, { latitude: point.lat, longitude: point.lng }]);
    } else {
      if (this.stops().length >= MAX_STOPS) return;
      this.stops.update((stops) => [
        ...stops,
        { name: `Punto ${stops.length + 1}`, latitude: point.lat, longitude: point.lng },
      ]);
    }
    this.dirty = true;
  }

  private drawLine(): void {
    this.lineLayer.clearLayers();
    // Sin trazado dibujado, se enseña la unión de los puntos de referencia, como la estimará la app.
    const line: GeoPoint[] = this.path().length > 1 ? this.path() : this.stops();
    if (line.length < 2) return;
    // Oscura: una línea amarilla se perdería entre las calles del mapa.
    L.polyline(line.map(latLng), { weight: 5, color: INK, opacity: 1, interactive: false }).addTo(this.lineLayer);
  }

  private drawStops(): void {
    this.markerLayer.clearLayers();
    const draggable = !this.locked();
    this.stops().forEach((stop, index) => {
      const element = document.createElement('div');
      element.className = 'mk mk-number';
      element.textContent = String(index + 1);
      const marker = L.marker(latLng(stop), {
        icon: L.divIcon({ className: '', html: element, iconSize: [30, 30] }),
        title: stop.name,
        draggable,
      });
      // Arrastrar un punto de referencia lo mueve. Mientras se arrastra solo se
      // repinta la línea: rehacer las marcas soltaría la que se lleva en la mano.
      marker.on('drag', () => {
        const { lat, lng } = marker.getLatLng();
        stop.latitude = lat;
        stop.longitude = lng;
        this.drawLine();
      });
      marker.on('dragend', () => this.touchStops());
      marker.addTo(this.markerLayer);
    });
  }

  /** Avisa de que un punto de referencia cambió por dentro (su nombre o su sitio). */
  private touchStops(): void {
    this.stops.update((stops) => [...stops]);
    this.dirty = true;
  }

  protected rename(stop: RouteStop, name: string): void {
    stop.name = name;
    this.dirty = true;
  }

  protected swapStops(a: number, b: number): void {
    this.stops.update((stops) => {
      const next = [...stops];
      [next[a], next[b]] = [next[b], next[a]];
      return next;
    });
    this.dirty = true;
  }

  protected removeStop(stop: RouteStop): void {
    this.stops.update((stops) => stops.filter((other) => other !== stop));
    this.dirty = true;
  }

  protected undo(): void {
    const points = this.mode() === 'path' ? this.path : this.stops;
    if (points().length === 0) return;
    (points as typeof this.path).update((list) => list.slice(0, -1));
    this.dirty = true;
  }

  protected async clearPath(): Promise<void> {
    if (this.path().length === 0) return;
    const confirmed = await this.ui.confirm({
      title: '¿Borrar el trazado dibujado?',
      message: 'Los puntos de referencia se conservan.',
      action: 'Borrar trazado',
    });
    if (!confirmed) return;
    this.path.set([]);
    this.dirty = true;
  }

  /**
   * Dibuja el recorrido siguiendo las calles entre los puntos de referencia,
   * en su orden: basta marcar por dónde pasa el micro, no cada curva.
   */
  protected async traceStreets(): Promise<void> {
    if (this.locked() || this.stops().length < 2) return;
    if (this.path().length > 0) {
      const replace = await this.ui.confirm({
        title: '¿Reemplazar el trazado?',
        message: 'El recorrido dibujado se cambiará por el que sigue las calles entre los puntos de referencia.',
        action: 'Reemplazar',
      });
      if (!replace) return;
    }

    this.tracing.set(true);
    const traced = await traceStreets(this.stops());
    this.tracing.set(false);
    if (traced === null || traced.points.length > MAX_PATH_POINTS) {
      this.store.onError(new ApiError('No se pudo trazar por las calles. Inténtalo de nuevo en un momento.'));
      return;
    }
    this.path.set(traced.points);
    this.dirty = true;
    this.ui.notify(
      `Recorrido trazado: ${(traced.meters / 1000).toFixed(1)} km. ` +
        'Si se desvía, añade un punto de referencia en la calle correcta y vuelve a trazar.',
    );
  }

  // --- Foto ---

  protected async pickImage(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    // Vacío, el mismo archivo se puede volver a elegir.
    input.value = '';
    if (file === undefined) return;
    const contentType = imageTypeOf(file);
    if (contentType === null || file.size > MAX_IMAGE_BYTES) {
      this.store.onError(new ApiError('Usa JPG, PNG o WebP de hasta 5 MB.'));
      return;
    }

    this.uploading.set(true);
    try {
      this.setImageUrl(await this.api.uploadImage(file, contentType));
      this.ui.notify('Foto subida. Guarda la ruta para publicarla.');
    } catch (error) {
      this.store.onError(error);
    } finally {
      this.uploading.set(false);
    }
  }

  protected setImageUrl(url: string): void {
    this.values.update((values) => ({ ...values, imageUrl: url }));
    this.dirty = true;
  }

  // --- Guardar, borrar, salir ---

  protected async save(): Promise<void> {
    if (this.locked()) return;
    this.checked.set(true);
    const stops = this.stops();
    if (Object.keys(this.problems()).length > 0 || stops.some((stop) => stop.name.trim() === '')) {
      this.store.onError(new ApiError('Revisa los campos marcados en rojo.'));
      return;
    }
    if (stops.length < 2) {
      this.store.onError(new ApiError('Añade al menos dos puntos de referencia en el mapa.'));
      return;
    }

    this.busy.set(true);
    try {
      this.store.saved(await this.api.saveRoute(this.snapshot()));
    } catch (error) {
      this.store.onError(error);
      this.busy.set(false);
    }
  }

  protected async delete(): Promise<void> {
    const id = this.route().id;
    if (id === null || this.locked()) return;
    const confirmed = await this.ui.confirm({
      title: '¿Eliminar esta ruta del catálogo?',
      message: 'Esta acción no se puede deshacer.',
      action: 'Eliminar ruta',
      destructive: true,
    });
    if (!confirmed) return;

    this.busy.set(true);
    try {
      await this.api.deleteRoute(id);
      this.store.deleted(id);
    } catch (error) {
      this.store.onError(error);
      this.busy.set(false);
    }
  }

  protected async back(): Promise<void> {
    if (this.locked()) return;
    if (this.dirty) {
      const leave = await this.ui.confirm({
        title: '¿Volver al catálogo?',
        message: 'Los cambios que no guardaste se perderán.',
        action: 'Salir sin guardar',
      });
      if (!leave) return;
    }
    this.store.editing.set(null);
  }
}
