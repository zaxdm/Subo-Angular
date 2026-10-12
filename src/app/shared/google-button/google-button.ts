import { Component, ElementRef, OnDestroy, afterNextRender, inject, output, signal, viewChild } from '@angular/core';

import { Api } from '../../core/api';
import { SiteInfo } from '../../core/site-info';

/** Lo que se usa de la biblioteca de Google (accounts.google.com/gsi/client) que carga index.html. */
interface GoogleAccounts {
  initialize(config: { client_id: string; nonce: string; callback: (response: { credential?: string }) => void }): void;
  renderButton(parent: HTMLElement, options: Record<string, string | number>): void;
}

const google = (): GoogleAccounts | undefined =>
  (window as { google?: { accounts?: { id?: GoogleAccounts } } }).google?.accounts?.id;

/** El desafío caduca a los cinco minutos: el botón se prepara con uno nuevo antes. */
const REFRESH_MS = 4 * 60 * 1000;

/**
 * El botón oficial de Google, pintado por Google dentro de la página.
 *
 * Cada acceso se firma con un desafío de un solo uso que da el servidor y
 * caduca a los cinco minutos, así que el botón se vuelve a preparar con uno
 * nuevo antes de que caduque. Tras un intento, quien lo usa llama a
 * [prepare] para que el siguiente lleve otro desafío.
 */
@Component({
  selector: 'app-google-button',
  styleUrl: './google-button.css',
  templateUrl: './google-button.html',
  host: { '[class.ready]': 'ready()' },
})
export class GoogleButton implements OnDestroy {
  /** Google confirmó la cuenta: su credencial y el desafío con el que se pidió. */
  readonly token = output<{ idToken: string; nonce: string }>();

  private readonly api = inject(Api);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly holder = viewChild.required<ElementRef<HTMLElement>>('holder');

  /** `false` si Google o el servidor no respondieron: no se enseña nada. */
  protected readonly ready = signal(false);

  private refresh?: ReturnType<typeof setInterval>;
  private destroyed = false;

  constructor() {
    afterNextRender(() => {
      void this.prepare();
      this.refresh = setInterval(() => void this.prepare(), REFRESH_MS);
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    clearInterval(this.refresh);
  }

  /** Pide un desafío nuevo y pinta el botón con él. */
  async prepare(): Promise<void> {
    try {
      // La biblioteca se carga aparte; se le da un momento a que llegue.
      for (let i = 0; i < 40 && google() === undefined; i++) {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      const accounts = google();
      if (accounts === undefined || this.destroyed) return;

      const nonce = await this.api.googleChallenge();
      if (this.destroyed) return;
      accounts.initialize({
        client_id: SiteInfo.googleClientId,
        nonce,
        callback: (response) => {
          if (response.credential && !this.destroyed) this.token.emit({ idToken: response.credential, nonce });
        },
      });
      // Cada preparación pinta el botón de nuevo: se quita el anterior.
      const holder = this.holder().nativeElement;
      holder.replaceChildren();
      accounts.renderButton(holder, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'rectangular',
        locale: 'es',
        // Google no pinta botones de más de 400 de ancho.
        width: Math.round(Math.min(400, Math.max(200, this.host.nativeElement.clientWidth))),
      });
      this.ready.set(true);
    } catch {
      // Sin Google se sigue pudiendo entrar con correo y contraseña.
    }
  }
}
