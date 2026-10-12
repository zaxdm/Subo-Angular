import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { Api } from '../../core/api';
import { Admin } from '../../core/models';
import { Store } from '../../core/store';
import { PageFrame } from '../../shared/page-frame/page-frame';

/**
 * Administradores: cuentas que entran al panel y graban rutas desde la app.
 *
 * Solo la ve el administrador principal, que es quien da y quita el acceso.
 */
@Component({
  imports: [FormsModule, PageFrame],
  selector: 'app-team',
  styleUrl: './team.css',
  templateUrl: './team.html',
})
export class Team {
  private readonly api = inject(Api);
  private readonly store = inject(Store);

  protected readonly email = signal('');

  /** `null` mientras llega la primera respuesta. */
  protected readonly people = signal<Admin[] | null>(null);
  protected readonly loading = signal(false);
  protected readonly adding = signal(false);

  /** Lo que le falta al correo escrito; `null` si no hay nada que decir. */
  protected readonly emailProblem = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.people.set(await this.api.admins());
    } catch (error) {
      this.people.update((people) => people ?? []);
      this.store.onError(error);
    } finally {
      this.loading.set(false);
    }
  }

  protected async add(): Promise<void> {
    const email = this.email().trim();
    if (this.adding()) return;
    if (!email.includes('@')) {
      this.emailProblem.set('Escribe el correo de la cuenta');
      return;
    }
    this.emailProblem.set(null);
    this.adding.set(true);
    try {
      const added = await this.api.addAdmin(email);
      this.people.update((people) => [...(people ?? []).filter((person) => person.id !== added.id), added]);
      this.email.set('');
    } catch (error) {
      this.store.onError(error);
    } finally {
      this.adding.set(false);
    }
  }

  protected async remove(person: Admin): Promise<void> {
    try {
      await this.api.removeAdmin(person.id);
      this.people.update((people) => people?.filter((other) => other.id !== person.id) ?? null);
    } catch (error) {
      this.store.onError(error);
    }
  }
}
