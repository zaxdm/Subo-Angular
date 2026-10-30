import { Injectable, computed, effect, signal } from '@angular/core';

import { load, save } from './storage';

/** Claro u oscuro a mano, o lo que diga el sistema. */
export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'theme';

function stored(): ThemeChoice {
  const value = load(KEY);
  return value === 'light' || value === 'dark' ? value : 'system';
}

/**
 * El modo claro u oscuro de la web. Por defecto sigue al sistema; si la
 * persona lo cambia, se queda con su elección en este navegador.
 *
 * Lo aplica poniendo `data-theme` en <html>, que es lo que miran las
 * variables de styles.css. index.html hace lo mismo antes de cargar Angular,
 * para que la página no parpadee en claro al abrirse de noche.
 */
@Injectable({ providedIn: 'root' })
export class Theme {
  // Sin matchMedia (las pruebas) se toma el sistema como claro.
  private readonly media = window.matchMedia?.('(prefers-color-scheme: dark)');
  private readonly systemDark = signal(this.media?.matches ?? false);

  readonly choice = signal<ThemeChoice>(stored());
  readonly dark = computed(() => this.choice() === 'dark' || (this.choice() === 'system' && this.systemDark()));

  constructor() {
    this.media?.addEventListener('change', (event) => this.systemDark.set(event.matches));
    effect(() => {
      const dark = this.dark();
      document.documentElement.dataset['theme'] = dark ? 'dark' : 'light';
      // La barra del navegador en el móvil: amarilla de día, tinta de noche.
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0E0F12' : '#FFC629');
    });
  }

  /** Pasa al modo contrario del que se ve y lo recuerda. */
  toggle(): void {
    this.set(this.dark() ? 'light' : 'dark');
  }

  set(choice: ThemeChoice): void {
    this.choice.set(choice);
    save(KEY, choice === 'system' ? null : choice);
  }
}
