import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { Api } from '../../core/api';
import {
  ApiError,
  MAX_IMAGE_BYTES,
  MyPayment,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  PaymentPlan,
  PremiumOffer,
  formatDate,
  formatDateTime,
  imageTypeOf,
  messageOf,
} from '../../core/models';
import { Store } from '../../core/store';
import { Ui } from '../../core/ui';

/** Cuántos días antes de vencer se avisa (lo mismo que el correo del servidor). */
const REMINDER_DAYS = 3;
const DAY_MS = 86_400_000;

/**
 * Subo Premium en el perfil: si está activo y hasta cuándo (con aviso cuando
 * vence pronto), comprarlo o renovarlo con Mercado Pago o Yape, y el historial
 * de compras con su número de comprobante.
 */
@Component({
  selector: 'app-premium-panel',
  styleUrl: './premium-panel.css',
  templateUrl: './premium-panel.html',
})
export class PremiumPanel implements OnInit {
  protected readonly store = inject(Store);
  private readonly api = inject(Api);
  private readonly ui = inject(Ui);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly offer = signal<PremiumOffer | null>(null);
  protected readonly history = signal<MyPayment[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly plan = signal<PaymentPlan | null>(null);
  /** Se abrió el pago con Yape: el QR y subir la captura. */
  protected readonly yapeOpen = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly statusLabels = PAYMENT_STATUS_LABELS;
  protected readonly methodLabels = PAYMENT_METHOD_LABELS;
  protected readonly formatDate = formatDate;
  protected readonly formatDateTime = formatDateTime;

  protected readonly until = computed(() => {
    const until = this.store.session()?.premiumUntil ?? null;
    return until !== null && until.getTime() > Date.now() ? until : null;
  });

  /** Días que le quedan de Premium, contando el de hoy; `null` sin Premium. */
  protected readonly daysLeft = computed(() => {
    const until = this.until();
    return until === null ? null : Math.max(1, Math.ceil((until.getTime() - Date.now()) / DAY_MS));
  });

  protected readonly endsSoon = computed(() => (this.daysLeft() ?? Infinity) <= REMINDER_DAYS);

  /** Tiene un Yape esperando que el equipo lo confirme. */
  protected readonly waiting = computed(() => {
    const mine = this.offer()?.mine;
    return mine?.status === 'PENDING' && mine.method === 'YAPE' ? mine : null;
  });

  async ngOnInit(): Promise<void> {
    await this.returnFromMercadoPago();
    await this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [offer, history] = await Promise.all([this.api.premiumOffer(), this.api.myPayments()]);
      this.offer.set(offer);
      this.history.set(history);
      // Por defecto, el plan más corto.
      if (this.plan() === null) this.plan.set(offer.plans[0] ?? null);
    } catch (error) {
      this.error.set(messageOf(error, 'No se pudo cargar Subo Premium.'));
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Mercado Pago devuelve a la persona a /perfil con `?pago=ok&payment_id=…`.
   * Se le pregunta al servidor por ese pago (por si el aviso de Mercado Pago
   * aún no llegó) y se pone la sesión al día.
   */
  private async returnFromMercadoPago(): Promise<void> {
    const params = this.route.snapshot.queryParamMap;
    const result = params.get('pago');
    if (result === null) return;
    const paymentId = params.get('payment_id') ?? params.get('collection_id');
    void this.router.navigate([], { queryParams: {}, replaceUrl: true });
    if (result === 'fallo') {
      this.ui.notify('El pago no se completó. No se te cobró nada.', 'error');
      return;
    }
    try {
      const status = paymentId ? await this.api.confirmCheckout(paymentId) : 'unknown';
      await this.refreshSession();
      if (status === 'approved') this.ui.notify('¡Listo! Tu Subo Premium está activo. Te enviamos el comprobante.');
      else this.ui.notify('Tu pago se está procesando. Te avisaremos cuando Mercado Pago lo confirme.');
    } catch (error) {
      this.store.onError(error);
    }
  }

  private async refreshSession(): Promise<void> {
    const session = this.store.session();
    if (session !== null) this.store.session.set(await this.api.me(session));
  }

  protected choose(plan: PaymentPlan): void {
    this.plan.set(plan);
  }

  protected async payWithMercadoPago(): Promise<void> {
    const plan = this.plan();
    if (plan === null || this.busy()) return;
    this.busy.set(true);
    try {
      // Se va a la página de pago de Mercado Pago; al terminar vuelve aquí.
      window.location.href = await this.api.checkout(plan.days);
    } catch (error) {
      this.store.onError(error);
      this.busy.set(false);
    }
  }

  protected async sendProof(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    const plan = this.plan();
    if (file === undefined || plan === null) return;
    const contentType = imageTypeOf(file);
    if (contentType === null || file.size > MAX_IMAGE_BYTES) {
      this.store.onError(new ApiError('Usa una captura JPG, PNG o WebP de hasta 5 MB.'));
      return;
    }
    this.busy.set(true);
    try {
      await this.api.sendPaymentProof(plan.days, file, contentType);
      this.yapeOpen.set(false);
      this.ui.notify('Recibimos tu comprobante. Te avisamos al confirmarlo.');
      await this.load();
    } catch (error) {
      this.store.onError(error);
    } finally {
      this.busy.set(false);
    }
  }
}
