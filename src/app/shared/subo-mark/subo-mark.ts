import { Component, input } from '@angular/core';

/**
 * El logo de Subo: los escalones del micro y un pasajero subiendo, sobre una
 * ficha crema. Es el mismo dibujo que el ícono de la app y el de la web.
 */
@Component({
  selector: 'app-subo-mark',
  styleUrl: './subo-mark.css',
  templateUrl: './subo-mark.html',
  host: { '[style.width.px]': 'size()', '[style.height.px]': 'size()', '[style.border-radius.px]': 'size() * 0.23' },
})
export class SuboMark {
  readonly size = input(34);
}
