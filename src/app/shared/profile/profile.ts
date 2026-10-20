import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { Api } from '../../core/api';
import { ApiError, MAX_IMAGE_BYTES, Session, imageTypeOf } from '../../core/models';
import { Store } from '../../core/store';

/**
 * Mi perfil: la cuenta con la que se entró, sea de pasajero o de
 * administrador. Deja cambiar el nombre y la foto, y cerrar sesión.
 */
@Component({
  imports: [FormsModule, RouterLink],
  selector: 'app-profile',
  styleUrl: './profile.css',
  templateUrl: './profile.html',
  host: { '[class.centered]': 'centered()' },
})
export class Profile {
  /**
   * En la web de los pasajeros va centrada; en el panel, a la izquierda como
   * el resto de secciones. Lo dice la ruta.
   */
  readonly centered = input(false);

  protected readonly store = inject(Store);
  private readonly api = inject(Api);

  protected readonly name = signal(this.store.session()?.name ?? '');
  protected readonly busy = signal(false);

  /** Lo último que salió bien, para decirlo junto al botón. */
  protected readonly done = signal<string | null>(null);

  /** Se intentó guardar un nombre vacío. */
  protected readonly missing = signal(false);

  protected readonly initial = computed(() => {
    const name = this.store.session()?.name.trim() ?? '';
    return name === '' ? '?' : name[0].toUpperCase();
  });

  protected readonly role = computed(() => {
    const session = this.store.session();
    if (session?.isSuperAdmin) return 'Administrador principal';
    return session?.isAdmin ? 'Administrador' : 'Pasajero';
  });

  /** Hace un cambio en la cuenta y, si sale bien, se queda con la sesión nueva. */
  private async change(change: (session: Session) => Promise<Session>, done: string): Promise<void> {
    const session = this.store.session();
    if (session === null) return;
    this.busy.set(true);
    this.done.set(null);
    try {
      this.store.session.set(await change(session));
      this.done.set(done);
    } catch (error) {
      this.store.onError(error);
    } finally {
      this.busy.set(false);
    }
  }

  protected async saveName(): Promise<void> {
    if (this.busy()) return;
    this.missing.set(this.name().trim() === '');
    if (this.missing()) return;
    await this.change((session) => this.api.rename(session, this.name()), 'Nombre guardado.');
  }

  protected async pickPhoto(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    // Vacío, el mismo archivo se puede volver a elegir.
    input.value = '';
    if (file === undefined) return;
    const contentType = imageTypeOf(file);
    if (contentType === null || file.size > MAX_IMAGE_BYTES) {
      this.store.onError(new ApiError('Usa JPG, PNG o WebP de hasta 5 MB.'));
      return;
    }
    await this.change((session) => this.api.changeAvatar(session, file, contentType), 'Foto actualizada.');
  }

  protected async removePhoto(): Promise<void> {
    await this.change((session) => this.api.removeAvatar(session), 'Foto quitada.');
  }
}
