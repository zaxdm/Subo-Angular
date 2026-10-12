import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { Api } from '../../core/api';
import { PremiumAccount, formatDate } from '../../core/models';
import { Store } from '../../core/store';
import { PageFrame } from '../../shared/page-frame/page-frame';

/** Cuánto se activa de una vez; el servidor admite cualquier número de días hasta un año. */
interface Plan {
  label: string;
  days: number;
}

/**
 * Subo Premium: las cuentas que tienen las funciones de pago.
 *
 * Solo la ve el administrador principal. Aquí se activa cuando la persona ya
 * pagó: la app de esa cuenta se entera sola la próxima vez que se abre.
 */
@Component({
  imports: [FormsModule, PageFrame],
  selector: 'app-premium',
  styleUrl: './premium.css',
  templateUrl: './premium.html',
})
export class Premium {
  private readonly api = inject(Api);
  private readonly store = inject(Store);

  protected readonly plans: Plan[] = [
    { label: '1 mes', days: 30 },
    { label: '3 meses', days: 90 },
    { label: '6 meses', days: 180 },
    { label: '1 año', days: 365 },
  ];

  protected readonly email = signal('');
  protected readonly days = signal(this.plans[0].days);

  /** `null` mientras llega la primera respuesta. */
  protected readonly accounts = signal<PremiumAccount[] | null>(null);
  protected readonly loading = signal(false);
  protected readonly adding = signal(false);

  /** Lo que le falta al correo escrito; `null` si no hay nada que decir. */
  protected readonly emailProblem = signal<string | null>(null);

  protected readonly formatDate = formatDate;

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.accounts.set(await this.api.premiumAccounts());
    } catch (error) {
      this.accounts.update((accounts) => accounts ?? []);
      this.store.onError(error);
    } finally {
      this.loading.set(false);
    }
  }

  /** Suma el tiempo elegido a la cuenta de ese correo; si ya era Premium, se alarga. */
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
      const added = await this.api.addPremium(email, Number(this.days()));
      this.accounts.update((accounts) =>
        [...(accounts ?? []).filter((account) => account.id !== added.id), added].sort(
          (a, b) => a.until.getTime() - b.until.getTime(),
        ),
      );
      this.email.set('');
    } catch (error) {
      this.store.onError(error);
    } finally {
      this.adding.set(false);
    }
  }

  protected async remove(account: PremiumAccount): Promise<void> {
    try {
      await this.api.removePremium(account.id);
      this.accounts.update((accounts) => accounts?.filter((other) => other.id !== account.id) ?? null);
    } catch (error) {
      this.store.onError(error);
    }
  }
}
