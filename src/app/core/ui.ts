import { Service, signal } from '@angular/core';

/** Un aviso corto al pie de la página. */
export interface Toast {
  message: string;
  kind: 'success' | 'error' | 'plain';
}

/** Una pregunta de sí o no, en una ventana sobre la página. */
export interface Confirmation {
  title: string;
  message: string;
  action: string;

  /** La acción borra algo: su botón va en rojo. */
  destructive?: boolean;
}

/** Los avisos y las preguntas que se enseñan encima de cualquier pantalla. */
@Service()
export class Ui {
  readonly toast = signal<Toast | null>(null);
  readonly confirmation = signal<Confirmation | null>(null);

  private toastTimer?: ReturnType<typeof setTimeout>;
  private answer?: (confirmed: boolean) => void;

  notify(message: string, kind: Toast['kind'] = 'success'): void {
    clearTimeout(this.toastTimer);
    this.toast.set({ message, kind });
    this.toastTimer = setTimeout(() => this.toast.set(null), kind === 'error' ? 8000 : 5000);
  }

  dismissToast(): void {
    clearTimeout(this.toastTimer);
    this.toast.set(null);
  }

  /** Pregunta y espera la respuesta; cerrar la ventana cuenta como un no. */
  confirm(confirmation: Confirmation): Promise<boolean> {
    this.answer?.(false);
    this.confirmation.set(confirmation);
    return new Promise((resolve) => (this.answer = resolve));
  }

  resolve(confirmed: boolean): void {
    this.confirmation.set(null);
    this.answer?.(confirmed);
    this.answer = undefined;
  }
}
