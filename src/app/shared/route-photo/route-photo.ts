import { Component, computed, effect, input, signal } from '@angular/core';

/** La foto del micro o, si no hay (o no carga), un fondo con la letra de la ruta. */
@Component({
  selector: 'app-route-photo',
  styleUrl: './route-photo.css',
  templateUrl: './route-photo.html',
})
export class RoutePhoto {
  /** Dirección HTTPS de la foto; `null` si la ruta no tiene. */
  readonly url = input<string | null>(null);
  readonly letter = input('');

  /** Texto en lugar de la letra cuando no hay foto (la vista previa del editor). */
  readonly emptyHint = input<string | null>(null);

  /** La foto no se pudo cargar. */
  protected readonly failed = signal(false);

  protected readonly hint = computed(() =>
    this.failed() && this.emptyHint() !== null ? 'No se pudo cargar la imagen. Revisa la URL.' : this.emptyHint(),
  );

  constructor() {
    // Otra dirección es otro intento.
    effect(() => {
      this.url();
      this.failed.set(false);
    });
  }
}
