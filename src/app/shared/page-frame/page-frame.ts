import { Component, input, output } from '@angular/core';

/**
 * El esqueleto de una sección del panel: su encabezado, el botón de actualizar
 * y, debajo, el contenido. Mientras llega la primera respuesta enseña que está
 * cargando; si no hay nada, lo dice.
 */
@Component({
  selector: 'app-page-frame',
  styleUrl: './page-frame.css',
  templateUrl: './page-frame.html',
})
export class PageFrame {
  readonly label = input.required<string>();
  readonly title = input.required<string>();
  readonly subtitle = input.required<string>();

  /** Hay una petición en marcha: el botón de actualizar espera. */
  readonly loading = input(false);

  /** Ya llegó la primera respuesta. */
  readonly ready = input(true);

  /** Qué decir cuando no hay nada que enseñar; `null` si hay contenido. */
  readonly emptyMessage = input<string | null>(null);

  readonly refresh = output<void>();
}
