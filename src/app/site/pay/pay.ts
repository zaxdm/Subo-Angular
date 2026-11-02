import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { Api } from '../../core/api';
import { PaymentPlan, PremiumOffer, messageOf } from '../../core/models';
import { Store } from '../../core/store';
import { Theme } from '../../core/theme';
import { Ui } from '../../core/ui';

/** El SDK de Mercado Pago, que se carga solo en esta página. */
const MP_SDK = 'https://sdk.mercadopago.com/js/v2';

type Result = 'aprobado' | 'pendiente' | 'rechazado' | 'cancelado';

/** Lo que dice Mercado Pago de un pago rechazado, en palabras de la gente. */
const REJECTIONS: Record<string, string> = {
  cc_rejected_insufficient_amount: 'La tarjeta no tiene saldo suficiente.',
  cc_rejected_bad_filled_security_code: 'El código de seguridad no es correcto.',
  cc_rejected_bad_filled_date: 'La fecha de vencimiento no es correcta.',
  cc_rejected_bad_filled_other: 'Revisa los datos de la tarjeta.',
  cc_rejected_call_for_authorize: 'Tu banco pide que autorices el pago. Llámalo y vuelve a intentarlo.',
  cc_rejected_card_disabled: 'La tarjeta no está activa. Actívala con tu banco.',
  cc_rejected_duplicated_payment: 'Ya hiciste un pago igual hace un momento.',
  cc_rejected_high_risk: 'Mercado Pago no aceptó el pago. Prueba con otra tarjeta o paga con Yape.',
  cc_rejected_max_attempts: 'Llegaste al límite de intentos. Prueba con otra tarjeta.',
};

// deno-lint-ignore no-explicit-any
type MercadoPagoSdk = any;
declare global {
  interface Window {
    MercadoPago?: new (publicKey: string, options: { locale: string }) => MercadoPagoSdk;
  }
}

function loadSdk(): Promise<void> {
  if (window.MercadoPago) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = MP_SDK;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('sdk'));
    document.head.appendChild(script);
  });
}

/**
 * Pagar Subo Premium sin salir de Subo: el formulario de Mercado Pago (Payment
 * Brick) va dentro de la página. Los datos de la tarjeta se escriben en campos
 * de Mercado Pago y nunca pasan por Subo: el servidor recibe solo un token.
 *
 * La app la abre dentro de sí misma (`?app=1`), con la sesión en el fragmento
 * de la dirección (`#t=…`), que no viaja a ningún servidor. Al terminar, la
 * página le avisa a la app con `subo-app://pago?estado=…`.
 */
@Component({
  imports: [RouterLink],
  selector: 'app-pay',
  styleUrl: './pay.css',
  templateUrl: './pay.html',
})
export class Pay implements OnInit, OnDestroy {
  private readonly api = inject(Api);
  private readonly store = inject(Store);
  private readonly ui = inject(Ui);
  private readonly theme = inject(Theme);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  /** Abierta desde la app: sin menú de la web y avisando a la app al terminar. */
  protected readonly inApp = this.route.snapshot.queryParamMap.get('app') === '1';

  protected readonly offer = signal<PremiumOffer | null>(null);
  protected readonly plan = signal<PaymentPlan | null>(null);
  protected readonly loading = signal(true);
  protected readonly paying = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Un pago que no se aprobó: el formulario se vuelve a mostrar para otro intento. */
  protected readonly rejected = signal<string | null>(null);
  protected readonly done = signal<Result | null>(null);

  protected readonly price = computed(() => this.plan()?.price ?? 0);

  private brick: { unmount(): void } | null = null;
  private email = '';

  async ngOnInit(): Promise<void> {
    try {
      // La app manda su sesión en el fragmento; la web usa la que ya tiene.
      const token = new URLSearchParams(location.hash.slice(1)).get('t');
      if (token) {
        this.api.useTemporaryToken(token);
        history.replaceState(null, '', location.pathname + location.search);
      }
      if (!this.api.isSignedIn) {
        this.error.set('Entra a tu cuenta para pagar Subo Premium.');
        return;
      }
      const session = this.store.session();
      const me = await this.api.me(
        session ?? { name: '', isAdmin: false, isSuperAdmin: false, email: '', avatarUrl: null },
      );
      this.email = me.email;
      const offer = await this.api.premiumOffer();
      this.offer.set(offer);
      const days = Number(this.route.snapshot.queryParamMap.get('dias'));
      this.plan.set(offer.plans.find((plan) => plan.days === days) ?? offer.plans[0] ?? null);
      if (!offer.mpPublicKey) {
        this.error.set('El pago con tarjeta aún no está disponible. Paga con Yape desde tu perfil.');
        return;
      }
      this.loading.set(false);
      await this.mountBrick();
    } catch (error) {
      this.error.set(messageOf(error, 'No se pudo abrir el pago. Revisa tu conexión e inténtalo de nuevo.'));
    } finally {
      this.loading.set(false);
    }
  }

  ngOnDestroy(): void {
    this.brick?.unmount();
  }

  protected async choose(plan: PaymentPlan): Promise<void> {
    if (this.paying() || plan.days === this.plan()?.days) return;
    this.plan.set(plan);
    this.rejected.set(null);
    await this.mountBrick();
  }

  /** Pone (o vuelve a poner) el formulario de Mercado Pago con el monto del plan elegido. */
  private async mountBrick(): Promise<void> {
    const offer = this.offer();
    const plan = this.plan();
    if (!offer?.mpPublicKey || !plan) return;
    this.brick?.unmount();
    this.brick = null;
    await loadSdk();
    const MercadoPago = window.MercadoPago;
    if (!MercadoPago) throw new Error('sdk');
    const mp = new MercadoPago(offer.mpPublicKey, { locale: 'es-PE' });
    this.brick = await mp.bricks().create('payment', 'mp-payment', {
      initialization: { amount: plan.price, payer: { email: this.email } },
      customization: {
        paymentMethods: { creditCard: 'all', debitCard: 'all' },
        visual: { style: { theme: this.theme.dark() ? 'dark' : 'default' } },
      },
      callbacks: {
        onReady: () => this.loading.set(false),
        onError: (error: unknown) => console.warn('Mercado Pago', error),
        onSubmit: ({ formData }: { formData: Record<string, unknown> }) => this.pay(formData),
      },
    });
  }

  private async pay(formData: Record<string, unknown>): Promise<void> {
    const plan = this.plan();
    if (!plan) return;
    this.paying.set(true);
    this.rejected.set(null);
    try {
      const result = await this.api.payDirect(plan.days, formData);
      if (result.status === 'approved') return this.finish('aprobado');
      if (result.status === 'in_process' || result.status === 'pending') return this.finish('pendiente');
      this.rejected.set(REJECTIONS[result.statusDetail] ?? 'El pago no se aprobó. No se te cobró nada.');
      await this.mountBrick();
    } catch (error) {
      this.rejected.set(messageOf(error, 'No se pudo completar el pago. Inténtalo de nuevo.'));
    } finally {
      this.paying.set(false);
    }
  }

  protected cancel(): void {
    this.finish('cancelado');
  }

  private async finish(result: Result): Promise<void> {
    this.done.set(result);
    if (this.inApp) {
      // La app cierra esta pantalla al ver esta dirección y pone su Premium al día.
      location.href = `subo-app://pago?estado=${result}`;
      return;
    }
    const session = this.store.session();
    if (session !== null && result !== 'cancelado') this.store.session.set(await this.api.me(session));
    if (result === 'aprobado') this.ui.notify('¡Listo! Tu Subo Premium está activo. Te enviamos el comprobante.');
    if (result === 'pendiente') this.ui.notify('Tu pago se está procesando. Te avisamos cuando se confirme.');
    void this.router.navigate(['/perfil']);
  }
}
