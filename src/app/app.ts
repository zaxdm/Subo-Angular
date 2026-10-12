import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { Store } from './core/store';
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
}
