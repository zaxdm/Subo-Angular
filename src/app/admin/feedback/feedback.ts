import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { Api } from '../../core/api';
import { SUGGESTION_STATUSES, Suggestion, SuggestionStatus, formatDateTime } from '../../core/models';
import { Store } from '../../core/store';
import { Ui } from '../../core/ui';
import { PageFrame } from '../../shared/page-frame/page-frame';

/**
 * El buzón de sugerencias: lo que la gente escribe desde Soporte en la app.
 *
 * Se pide al servidor al abrir la pantalla, no al entrar al panel: quien solo
 * viene a editar rutas no espera por él.
 */
@Component({
  imports: [FormsModule, PageFrame],
  selector: 'app-feedback',
  styleUrl: './feedback.css',
  templateUrl: './feedback.html',
})
export class Feedback {
  private readonly api = inject(Api);
  private readonly store = inject(Store);
  private readonly ui = inject(Ui);

  protected readonly statuses = SUGGESTION_STATUSES;
  protected readonly formatDateTime = formatDateTime;

  /** `null` mientras llega la primera respuesta. */
  protected readonly items = signal<Suggestion[] | null>(null);
  protected readonly loading = signal(false);

  /** La sugerencia que se está contestando, y lo escrito hasta ahora. */
  protected readonly replying = signal<Suggestion | null>(null);
  protected readonly reply = signal('');

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.items.set(await this.api.feedback());
    } catch (error) {
      // Sin lista que enseñar, al menos no se queda cargando para siempre.
      this.items.update((items) => items ?? []);
      this.store.onError(error);
    } finally {
      this.loading.set(false);
    }
  }

  protected authorOf(item: Suggestion): string {
    return [item.userName, item.userEmail].filter(Boolean).join(' · ') || 'Cuenta eliminada';
  }

  protected originOf(item: Suggestion): string {
    return [item.appVersion === '' ? null : `Versión ${item.appVersion}`, item.device].filter(Boolean).join(' · ');
  }

  protected async delete(item: Suggestion): Promise<void> {
    const confirmed = await this.ui.confirm({
      title: '¿Eliminar esta sugerencia?',
      message: 'Se borra del buzón y no se puede recuperar.',
      action: 'Eliminar',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await this.api.deleteFeedback(item.id);
      this.items.update((items) => items?.filter((other) => other.id !== item.id) ?? null);
    } catch (error) {
      this.store.onError(error);
    }
  }

  /** Guarda el estado y la respuesta; quien escribió la sugerencia los ve en la app. */
  protected async review(item: Suggestion, status: SuggestionStatus, reply: string | null): Promise<void> {
    try {
      await this.api.reviewFeedback(item.id, status, reply);
      this.items.update(
        (items) => items?.map((other) => (other.id === item.id ? { ...other, status, reply } : other)) ?? null,
      );
    } catch (error) {
      // El desplegable vuelve a decir el estado que sigue guardado.
      this.items.update((items) => items?.map((other) => (other.id === item.id ? { ...other } : other)) ?? null);
      this.store.onError(error);
    }
  }

  protected openReply(item: Suggestion): void {
    this.reply.set(item.reply ?? '');
    this.replying.set(item);
  }

  /** Contestar deja la sugerencia como resuelta. */
  protected async saveReply(): Promise<void> {
    const item = this.replying();
    const reply = this.reply().trim();
    this.replying.set(null);
    if (item === null) return;
    await this.review(item, reply === '' ? item.status : 'RESOLVED', reply === '' ? null : reply);
  }
}
