import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { Api } from '../../core/api';
import { contactChannels } from '../../core/site-info';
import { Store } from '../../core/store';

/**
 * Cómo escribirle a Subo: un formulario que llega al buzón del administrador
 * y, al lado, el correo, WhatsApp y las redes.
 */
@Component({
  imports: [FormsModule],
  selector: 'app-contact',
  styleUrl: './contact.css',
  templateUrl: './contact.html',
})
export class Contact {
  protected readonly store = inject(Store);
  private readonly api = inject(Api);

  protected readonly subjects = ['Una ruta está mal', 'Falta una línea', 'Problema con mi cuenta', 'Sugerencia', 'Otro'];

  /** Los medios que ya existen se pueden abrir; los que faltan se anuncian. */
  protected readonly ready = contactChannels().filter((channel) => channel.link !== null);
  protected readonly soon = contactChannels().filter((channel) => channel.link === null);

  protected readonly subject = signal(this.subjects[0]);
  protected readonly message = signal('');
  protected readonly busy = signal(false);
  protected readonly sent = signal(false);

  /** Se intentó enviar sin escribir nada. */
  protected readonly missing = signal(false);

  protected async send(): Promise<void> {
    if (this.busy()) return;
    this.missing.set(this.message().trim() === '');
    if (this.missing()) return;
    // El buzón pide cuenta: lo escrito se queda esperando mientras se entra.
    if (this.store.session() === null) {
      this.store.openLogin();
      return;
    }
    this.busy.set(true);
    try {
      await this.api.sendFeedback(this.subject(), this.message());
      this.sent.set(true);
      this.message.set('');
    } catch (error) {
      this.store.onError(error);
    } finally {
      this.busy.set(false);
    }
  }
}
