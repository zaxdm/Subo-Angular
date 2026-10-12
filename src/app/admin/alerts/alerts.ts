import { Component, inject, signal } from '@angular/core';

import { Api } from '../../core/api';
import { ModerationAlert, formatDateTime, safeUrl } from '../../core/models';
import { Store } from '../../core/store';
import { Ui } from '../../core/ui';
import { PageFrame } from '../../shared/page-frame/page-frame';

/**
 * Moderación: las alertas que están a la vista ahora mismo y quién las puso.
 *
 * Desde aquí se borra la que sea falsa u ofensiva y se bloquea a quien abusa.
 * Una cuenta bloqueada sigue entrando, pero no publica y lo suyo deja de verse.
 */
@Component({
  imports: [PageFrame],
  selector: 'app-alerts',
  styleUrl: './alerts.css',
  templateUrl: './alerts.html',
})
export class Alerts {
  private readonly api = inject(Api);
  private readonly store = inject(Store);
  private readonly ui = inject(Ui);

  protected readonly formatDateTime = formatDateTime;
  protected readonly safeUrl = safeUrl;

  /** `null` mientras llega la primera respuesta. */
  protected readonly alerts = signal<ModerationAlert[] | null>(null);
  protected readonly loading = signal(false);

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.alerts.set(await this.api.moderationAlerts());
    } catch (error) {
      this.alerts.update((alerts) => alerts ?? []);
      this.store.onError(error);
    } finally {
      this.loading.set(false);
    }
  }

  protected authorOf(item: ModerationAlert): string {
    return [item.authorName, item.authorEmail].filter(Boolean).join(' · ') || 'Cuenta sin datos';
  }

  protected async delete(item: ModerationAlert): Promise<void> {
    const confirmed = await this.ui.confirm({
      title: '¿Eliminar esta alerta?',
      message: 'Desaparece del mapa de todos y no se puede recuperar.',
      action: 'Eliminar',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await this.api.deleteAlert(item.alert.id);
      this.alerts.update((alerts) => alerts?.filter((other) => other.alert.id !== item.alert.id) ?? null);
    } catch (error) {
      this.store.onError(error);
    }
  }

  protected async toggleBlock(item: ModerationAlert): Promise<void> {
    const block = !item.authorBlocked;
    const who = item.authorName ?? item.authorEmail ?? 'esta cuenta';
    if (
      block &&
      !(await this.ui.confirm({
        title: `¿Bloquear a ${who}?`,
        message:
          'No podrá publicar alertas, fotos, calificaciones ni sugerencias, y lo que ya publicó dejará de verse. ' +
          'Se puede desbloquear después.',
        action: 'Bloquear',
        destructive: true,
      }))
    ) {
      return;
    }
    try {
      await this.api.blockUser(item.authorId, block);
      // El bloqueo es de la cuenta: vale para todas sus alertas de la lista.
      this.alerts.update(
        (alerts) =>
          alerts?.map((other) => (other.authorId === item.authorId ? { ...other, authorBlocked: block } : other)) ??
          null,
      );
    } catch (error) {
      this.store.onError(error);
    }
  }
}
