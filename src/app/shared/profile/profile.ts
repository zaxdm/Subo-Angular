import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { Api } from '../../core/api';
import { ApiError, MAX_IMAGE_BYTES, Session, imageTypeOf } from '../../core/models';
import { Store } from '../../core/store';
import { Ui } from '../../core/ui';
import { PremiumPanel } from '../premium-panel/premium-panel';

/**
 * Mi perfil: la cuenta con la que se entró, sea de pasajero o de
 * administrador. Deja cambiar el nombre y la foto, y cerrar sesión.
 */
@Component({
  imports: [FormsModule, RouterLink, PremiumPanel],
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
  private readonly ui = inject(Ui);

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

  /** En el panel de administración: ahí el perfil enseña lo de su rol, no lo de pasajero. */
  protected readonly inPanel = computed(() => !this.centered() && this.store.isAdmin());

  /** Lo que puede hacer esa cuenta en el panel. */
  protected readonly powers = computed(() => {
    const session = this.store.session();
    if (!session?.isAdmin) return [];
    const common = ['Crear y editar rutas', 'Moderar alertas y sugerencias', 'Ver estadísticas y usuarios'];
    return session.isSuperAdmin
      ? [...common, 'Confirmar pagos de Premium', 'Finanzas', 'Dar o quitar administradores']
      : common;
  });

  // --- Cambiar la contraseña ---
  protected readonly passwordOpen = signal(false);
  protected readonly currentPassword = signal('');
  protected readonly newPassword = signal('');
  protected readonly passwordProblem = signal<string | null>(null);

  // --- Eliminar la cuenta ---
  protected readonly deleteOpen = signal(false);
  protected readonly deletePassword = signal('');
  protected readonly deleteWord = signal('');
  protected readonly deleteProblem = signal<string | null>(null);

  protected async deleteAccount(): Promise<void> {
    if (this.busy()) return;
    if (this.deleteWord().trim().toUpperCase() !== 'ELIMINAR') {
      this.deleteProblem.set('Escribe ELIMINAR para confirmar');
      return;
    }
    this.deleteProblem.set(null);
    this.busy.set(true);
    try {
      await this.api.deleteAccount(this.deletePassword(), this.deleteWord());
      this.store.signOut();
      this.ui.notify('Tu cuenta y tus datos se eliminaron.');
    } catch (error) {
      if (error instanceof ApiError && !error.unauthorized) this.deleteProblem.set(error.message);
      else this.store.onError(error);
    } finally {
      this.busy.set(false);
    }
  }

  protected async savePassword(): Promise<void> {
    if (this.busy()) return;
    if (this.newPassword().length < 8) {
      this.passwordProblem.set('La contraseña nueva necesita al menos 8 caracteres');
      return;
    }
    this.passwordProblem.set(null);
    this.busy.set(true);
    this.done.set(null);
    try {
      await this.api.changePassword(this.currentPassword(), this.newPassword());
      this.currentPassword.set('');
      this.newPassword.set('');
      this.passwordOpen.set(false);
      this.done.set('Contraseña cambiada. Se cerró tu sesión en los demás dispositivos.');
    } catch (error) {
      if (error instanceof ApiError && !error.unauthorized) this.passwordProblem.set(error.message);
      else this.store.onError(error);
    } finally {
      this.busy.set(false);
    }
  }

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
