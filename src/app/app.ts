import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { Store } from './core/store';
import { Theme } from './core/theme';
import { Ui } from './core/ui';
import { Login } from './shared/login/login';

@Component({
  imports: [RouterOutlet, Login],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  protected readonly store = inject(Store);
  protected readonly ui = inject(Ui);
  // Se crea al arrancar para que el modo oscuro siga al sistema desde el principio.
  private readonly theme = inject(Theme);
}
