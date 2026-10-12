import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Store } from '../../core/store';

/** La portada: quiénes somos y qué hace Subo. Es lo primero que se ve. */
@Component({
  imports: [RouterLink],
  selector: 'app-about',
  styleUrl: './about.css',
  templateUrl: './about.html',
})
export class About {
  /** Las líneas publicadas, para contar cuánto hay ya en el mapa. */
  protected readonly routes = inject(Store).lines;

  protected readonly stops = computed(() => this.routes().reduce((total, route) => total + route.stops.length, 0));

  /** Una línea de verdad para los ejemplos; `null` mientras carga el catálogo. */
  protected readonly sample = computed(() => this.routes()[0] ?? null);

  /** Las dos líneas que se ven en el teléfono de la portada. */
  protected readonly phoneLines = computed(() => this.routes().slice(0, 2));

  protected readonly gallery = [1, 2, 3];

  protected readonly promises = [
    {
      icon: 'volunteer_activism',
      title: 'Gratis para pasajeros',
      body: 'Mirar las líneas y los avisos no cuesta nada, ni en la web ni en la app.',
    },
    {
      icon: 'lock',
      title: 'Tus datos son tuyos',
      body: 'No vendemos tus datos y solo pedimos lo necesario para que la cuenta funcione.',
    },
    { icon: 'sync', title: 'Una sola cuenta', body: 'La misma cuenta sirve en el celular y en el navegador.' },
  ];
}
