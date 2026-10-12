import { Component, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { Api } from '../../core/api';
import { Session, messageOf } from '../../core/models';
import { Store } from '../../core/store';
import { GoogleButton } from '../google-button/google-button';
import { SuboMark } from '../subo-mark/subo-mark';

const PASSWORD_MIN_LENGTH = 8;

/**
 * La puerta de Subo: entrar o crear una cuenta de pasajero, en una ventana
 * sobre la página.
 *
 * Pasajeros y administradores entran por aquí con el mismo formulario; el
 * servidor decide a dónde va cada uno. También se entra con Google. La
 * contraseña no se guarda en el navegador.
 */
@Component({
  imports: [FormsModule, GoogleButton, SuboMark],
  selector: 'app-login',
  styleUrl: './login.css',
  templateUrl: './login.html',
})
export class Login {
  protected readonly store = inject(Store);
  private readonly api = inject(Api);
  private readonly googleButton = viewChild(GoogleButton);

  protected readonly passwordMinLength = PASSWORD_MIN_LENGTH;

  protected readonly name = signal('');
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly code = signal('');

  /** El correo que espera su código para terminar de crear la cuenta; `null` si no se está en ese paso. */
  protected readonly confirming = signal<string | null>(null);

  /** Un aviso que no es un fallo, como que se mandó otro código. */
  protected readonly notice = signal<string | null>(null);

  /** `true`: se está creando una cuenta en lugar de entrar con una. */
  protected readonly registering = signal(false);
  protected readonly busy = signal(false);
  protected readonly showPassword = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Lo que le falta a cada campo, tras intentar enviar el formulario. */
  protected readonly problems = signal<{ name?: string; email?: string; password?: string }>({});

  /** Hace [work] con el formulario bloqueado y enseña el fallo si lo hay. */
  private async run(work: () => Promise<void>, fallback: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      await work();
    } catch (error) {
      this.api.signOut();
      this.error.set(messageOf(error, fallback));
    } finally {
      this.busy.set(false);
    }
  }

  private validate(): boolean {
    const problems: { name?: string; email?: string; password?: string } = {};
    if (this.registering() && this.name().trim() === '') problems.name = 'Escribe tu nombre';
    if (!this.email().trim().includes('@')) problems.email = 'Escribe tu correo';
    if (this.password() === '') problems.password = 'Escribe tu contraseña';
    else if (this.registering() && this.password().length < PASSWORD_MIN_LENGTH) {
      problems.password = `Usa al menos ${PASSWORD_MIN_LENGTH} caracteres`;
    }
    this.problems.set(problems);
    return Object.keys(problems).length === 0;
  }

  protected async submit(): Promise<void> {
    if (!this.validate()) return;
    const registering = this.registering();
    await this.run(
      async () => {
        const session = registering
          ? await this.api.register(this.name(), this.email(), this.password())
          : await this.api.signIn(this.email(), this.password());
        // Falta confirmar el correo: se pasa a pedir el código que le llegó.
        if (session === null) this.confirming.set(this.email().trim());
        else await this.enter(session);
      },
      registering
        ? 'No se pudo crear la cuenta. Inténtalo de nuevo.'
        : 'No se pudo iniciar sesión. Inténtalo de nuevo.',
    );
  }

  /** Con el código del correo, la cuenta se crea y se entra. */
  protected async confirm(): Promise<void> {
    const email = this.confirming();
    if (email === null) return;
    if (this.code().trim().length !== 6) {
      this.error.set('Escribe los 6 dígitos del código');
      return;
    }
    await this.run(
      async () => this.enter(await this.api.confirmRegistration(email, this.code())),
      'No se pudo confirmar el código. Inténtalo de nuevo.',
    );
  }

  /** Pide otro código para el mismo registro. */
  protected async resend(): Promise<void> {
    await this.run(async () => {
      const session = await this.api.register(this.name(), this.email(), this.password());
      if (session !== null) await this.enter(session);
      else this.notice.set('Listo. Si no te llega en un minuto, revisa el correo no deseado y vuelve a pedirlo.');
    }, 'No se pudo enviar otro código. Inténtalo de nuevo.');
  }

  protected changeEmail(): void {
    this.confirming.set(null);
    this.code.set('');
    this.error.set(null);
    this.notice.set(null);
  }

  /** Google ya confirmó la cuenta; el servidor comprueba su credencial. */
  protected async withGoogle(token: { idToken: string; nonce: string }): Promise<void> {
    await this.run(
      // Si el correo ya tenía cuenta, la contraseña escrita sirve para unirlas.
      async () => this.enter(await this.api.signInWithGoogle(token.idToken, token.nonce, this.password())),
      'No se pudo entrar con Google. Inténtalo de nuevo.',
    );
    // Cada intento con Google gasta su desafío: el botón pide otro.
    void this.googleButton()?.prepare();
  }

  /** Con la sesión abierta, carga lo que le toca ver a esa cuenta y entra. */
  private async enter(session: Session): Promise<void> {
    const routes = session.isAdmin ? await this.api.routes() : await this.api.publicRoutes();
    this.password.set('');
    this.store.signedIn(session, routes);
  }

  protected toggleMode(): void {
    this.registering.update((registering) => !registering);
    this.error.set(null);
    this.problems.set({});
  }
}
