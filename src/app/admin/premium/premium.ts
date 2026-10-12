import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { Api } from '../../core/api';
import {
  PaymentConfig,
  PremiumAccount,
  PremiumPayment,
  formatDate,
  formatDateTime,
  imageTypeOf,
} from '../../core/models';
import { Store } from '../../core/store';
import { Ui } from '../../core/ui';
import { PageFrame } from '../../shared/page-frame/page-frame';

/** Cuánto se activa de una vez; el servidor admite cualquier número de días hasta un año. */
interface Plan {
  label: string;
  days: number;
}

/**
 * Subo Premium: las cuentas que tienen las funciones de pago.
 *
 * Solo la ve el administrador principal. La gente paga por Yape al QR que se
 * pone aquí y sube la captura desde la app; al confirmarla, su cuenta pasa a
 * Premium y la app se entera sola la próxima vez que se abre. También se puede
 * activar a mano, con el correo.
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
  private readonly ui = inject(Ui);

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
  protected readonly formatDateTime = formatDateTime;

  // --- Pago por Yape ---

  /** El QR al que se paga; `null` si aún no se subió. */
  protected readonly qrUrl = signal<string | null>(null);
  protected readonly holder = signal('');

  /** El precio de cada plan, tal como se escribe; vacío si ese plan no se ofrece. */
  protected readonly prices = signal<Record<number, string>>({});
  protected readonly savingYape = signal(false);
  protected readonly uploadingQr = signal(false);

  /** Los comprobantes que subió la gente; `null` mientras llegan. */
  protected readonly payments = signal<PremiumPayment[] | null>(null);

  /** El comprobante que se está confirmando o rechazando, para no pulsar dos veces. */
  protected readonly reviewing = signal<string | null>(null);

  /** La captura que se está mirando en grande. */
  protected readonly zoomed = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [accounts, payments, config] = await Promise.all([
        this.api.premiumAccounts(),
        this.api.premiumPayments(),
        this.api.paymentConfig(),
      ]);
      this.accounts.set(accounts);
      this.payments.set(payments);
      this.showConfig(config);
    } catch (error) {
      this.accounts.update((accounts) => accounts ?? []);
      this.payments.update((payments) => payments ?? []);
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

  private showConfig(config: PaymentConfig): void {
    this.qrUrl.set(config.qrUrl);
    this.holder.set(config.holder);
    this.prices.set(Object.fromEntries(config.plans.map((plan) => [plan.days, String(plan.price)])));
  }

  protected setPrice(days: number, value: string): void {
    this.prices.update((prices) => ({ ...prices, [days]: value }));
  }

  /** Sube la imagen del QR. No se guarda hasta pulsar Guardar. */
  protected async pickQr(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const contentType = imageTypeOf(file);
    if (contentType === null) {
      this.ui.notify('Usa una imagen JPG, PNG o WebP.', 'plain');
      return;
    }
    this.uploadingQr.set(true);
    try {
      this.qrUrl.set(await this.api.uploadImage(file, contentType));
    } catch (error) {
      this.store.onError(error);
    } finally {
      this.uploadingQr.set(false);
    }
  }

  protected async saveYape(): Promise<void> {
    if (this.savingYape()) return;
    const plans = this.plans
      .map((plan) => ({ days: plan.days, price: Number(String(this.prices()[plan.days] ?? '').replace(',', '.')) }))
      .filter((plan) => Number.isFinite(plan.price) && plan.price > 0);
    this.savingYape.set(true);
    try {
      this.showConfig(
        await this.api.savePaymentConfig({ qrUrl: this.qrUrl(), holder: this.holder().trim(), plans }),
      );
      this.ui.notify('Pago por Yape guardado.');
    } catch (error) {
      this.store.onError(error);
    } finally {
      this.savingYape.set(false);
    }
  }

  protected planLabel(days: number): string {
    return this.plans.find((plan) => plan.days === days)?.label ?? `${days} días`;
  }

  /** Confirma el pago: la cuenta pasa a Premium por los días que pagó. */
  protected async approve(payment: PremiumPayment): Promise<void> {
    const confirmed = await this.ui.confirm({
      title: 'Confirmar el pago',
      message: `¿Ya viste en tu Yape los S/ ${payment.amount} de ${payment.userName || payment.userEmail}? Se le activará Premium por ${this.planLabel(payment.days)}.`,
      action: 'Confirmar',
    });
    if (confirmed) await this.review(payment, true);
  }

  protected async reject(payment: PremiumPayment): Promise<void> {
    const confirmed = await this.ui.confirm({
      title: 'Rechazar el comprobante',
      message: `${payment.userName || payment.userEmail} verá que su pago no se pudo confirmar y podrá subir otro.`,
      action: 'Rechazar',
      destructive: true,
    });
    if (confirmed) {
      await this.review(payment, false, 'No pudimos confirmar tu pago. Revisa la captura y súbela de nuevo');
    }
  }

  private async review(payment: PremiumPayment, approved: boolean, note = ''): Promise<void> {
    if (this.reviewing() !== null) return;
    this.reviewing.set(payment.id);
    try {
      await this.api.reviewPayment(payment.id, approved, note);
      this.ui.notify(approved ? 'Pago confirmado: la cuenta ya es Premium.' : 'Comprobante rechazado.');
    } catch (error) {
      this.store.onError(error);
    } finally {
      this.reviewing.set(null);
    }
    // Se vuelve a pedir todo: cambia el comprobante y, si se aprobó, la lista de cuentas.
    await this.load();
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
