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
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import * as L from 'leaflet';

import { LiveTrip, TRIP_STALE_MS, ago, fetchLiveTrip } from '../../core/live-trip';
import { GeoPoint, routeTitle } from '../../core/models';
import { Store } from '../../core/store';

const TRUJILLO: L.LatLngTuple = [-8.112, -79.0288];

/** Cada cuánto se pregunta por dónde va: lo mismo que tarda la app en mandarlo. */
const REFRESH_MS = 10_000;

const latLng = (point: GeoPoint): L.LatLngTuple => [point.latitude, point.longitude];

function badge(className: string, size: number): L.DivIcon {
  const element = document.createElement('div');
  element.className = `mk ${className}`;
  return L.divIcon({ className: '', html: element, iconSize: [size, size] });
}

/**
 * Un viaje en vivo: el mapa con por dónde va quien compartió el enlace desde la
 * app, la línea en la que viaja y dónde se baja.
 *
 * No pide cuenta: quien recibe el enlace solo tiene que abrirlo. La página
 * pregunta al servidor cada pocos segundos hasta que el viaje termina.
 */
@Component({
  imports: [RouterLink],
  selector: 'app-trip',
  styleUrl: './trip.css',
  templateUrl: './trip.html',
})
export class Trip implements OnDestroy {
  /** El viaje, tomado de la dirección `/viaje/<id>`. */
  readonly id = input.required<string>();

  private readonly store = inject(Store);
  private readonly mapElement = viewChild.required<ElementRef<HTMLElement>>('map');

  /** `undefined` mientras llega la primera respuesta; `null` si ese viaje no existe. */
  protected readonly trip = signal<LiveTrip | null | undefined>(undefined);

  /** La última vez no hubo conexión: lo que se ve puede estar viejo. */
  protected readonly offline = signal(false);

  /** La hora, puesta al día cada pocos segundos, para decir hace cuánto se movió. */
  private readonly now = signal(Date.now());

  protected readonly route = computed(() => {
    const routeId = this.trip()?.routeId;
    return routeId ? (this.store.lines().find((line) => line.id === routeId) ?? null) : null;
  });

  protected readonly title = computed(() => {
    const trip = this.trip();
    if (!trip) return '';
    const who = trip.name === '' ? 'Tu contacto' : trip.name;
    if (trip.ended) return `${who} ya terminó su viaje`;
    const route = this.route();
    return route ? `${who} va en ${routeTitle(route)}` : `${who} va en camino`;
  });

  /** Lo que se sabe de la posición, en una frase. */
  protected readonly status = computed(() => {
    const trip = this.trip();
    if (!trip || trip.ended) return '';
    if (trip.position === null) return 'Esperando su ubicación…';
    const when = ago(trip.updatedAt, this.now());
    return this.stale() ? `Sin señal: su última ubicación es de ${when}` : `Ubicación de ${when}`;
  });

  protected readonly stale = computed(() => {
    const trip = this.trip();
    return !!trip && !trip.ended && this.now() - trip.updatedAt.getTime() > TRIP_STALE_MS;
  });

  // --- El mapa ---

  private map?: L.Map;
  private readonly ready = signal(false);
  private readonly lineLayer = L.layerGroup();
  private readonly markerLayer = L.layerGroup();
  private framed = false;

  private readonly refresh = setInterval(() => void this.load(), REFRESH_MS);
  private readonly clock = setInterval(() => this.now.set(Date.now()), 5_000);

  constructor() {
    afterNextRender(() => {
      // El id llega con la dirección: antes de pintar todavía no está.
      void this.load();
      const map = L.map(this.mapElement().nativeElement, {
        center: TRUJILLO,
        zoom: 13,
        minZoom: 10,
        maxZoom: 19,
        zoomControl: false,
        attributionControl: false,
      });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxNativeZoom: 19, maxZoom: 19 }).addTo(map);
      L.control.zoom({ position: 'bottomright' }).addTo(map);
      this.lineLayer.addTo(map);
      this.markerLayer.addTo(map);
      this.map = map;
      this.ready.set(true);
    });

    effect(() => {
      if (this.ready()) this.draw();
    });
  }

  ngOnDestroy(): void {
    clearInterval(this.refresh);
    clearInterval(this.clock);
    this.map?.remove();
  }

  private async load(): Promise<void> {
    // Un viaje terminado, o un enlace que no existe, ya no va a cambiar.
    const current = this.trip();
    if (current === null || current?.ended) return;
    try {
      this.trip.set(await fetchLiveTrip(this.id()));
      this.offline.set(false);
    } catch {
      this.offline.set(true);
    }
    this.now.set(Date.now());
  }

  private draw(): void {
    const trip = this.trip();
    const route = this.route();
    this.lineLayer.clearLayers();
    this.markerLayer.clearLayers();
    if (!trip) return;

    const line = route ? (route.path.length >= 2 ? route.path : route.stops).map(latLng) : [];
    if (line.length >= 2) {
      L.polyline(line, { weight: 8, color: '#15171c', interactive: false }).addTo(this.lineLayer);
      L.polyline(line, { weight: 5, color: '#ffc629', interactive: false }).addTo(this.lineLayer);
    }
    if (trip.stop) {
      L.marker(latLng(trip.stop), { icon: badge('mk-stop end', 20), keyboard: false })
        .bindTooltip(trip.stop.name === '' ? 'Aquí se baja' : `Se baja en ${trip.stop.name}`, { direction: 'top' })
        .addTo(this.markerLayer);
    }
    if (trip.position) {
      L.marker(latLng(trip.position), { icon: badge('mk-me', 24), keyboard: false, zIndexOffset: 1000 }).addTo(
        this.markerLayer,
      );
    }
    this.frame(trip, line);
  }

  /**
   * La primera vez encuadra el viaje entero: dónde va y dónde se baja. Después
   * solo sigue a quien viaja, sin deshacer el acercamiento de quien mira.
   */
  private frame(trip: LiveTrip, line: L.LatLngTuple[]): void {
    const map = this.map;
    if (!map) return;
    if (trip.position && this.framed) {
      if (!map.getBounds().pad(-0.2).contains(latLng(trip.position))) map.panTo(latLng(trip.position));
      return;
    }
    const points = [trip.position, trip.stop].filter((point) => point !== null).map(latLng);
    if (points.length === 0) {
      // Sin posición todavía, al menos se ve la línea en la que viaja.
      if (line.length >= 2) map.fitBounds(L.latLngBounds(line), { padding: [40, 40], animate: false });
      return;
    }
    if (points.length === 1) map.setView(points[0], 16, { animate: false });
    else map.fitBounds(L.latLngBounds(points), { padding: [60, 60], maxZoom: 16, animate: false });
    this.framed = trip.position !== null;
  }
}
