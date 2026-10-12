import { Component, ElementRef, computed, input, signal, viewChildren } from '@angular/core';
import { RouterLink } from '@angular/router';

/** El texto de una página legal. */
interface LegalText {
  title: string;
  lead: string;

  /** Lo esencial en tres líneas; vacío si la página no lo lleva. */
  summary: string[];

  /** Cada apartado: su título y su texto. */
  sections: { title: string; body: string }[];
}

const PRIVACY: LegalText = {
  title: 'Qué datos usamos y para qué',
  lead: 'Te lo contamos sin letra pequeña. Si algo no queda claro, escríbenos desde Contacto.',
  summary: [
    'No vendemos ni alquilamos tus datos.',
    'No guardamos un historial de por dónde te mueves.',
    'Puedes pedir que borremos tu cuenta cuando quieras.',
  ],
  sections: [
    {
      title: 'Datos de tu cuenta',
      body:
        'Al crear una cuenta guardamos tu nombre, tu correo y tu contraseña. La contraseña se guarda cifrada: ' +
        'nadie del equipo puede leerla. Si entras con Google, recibimos tu nombre, tu correo y tu foto de perfil.',
    },
    {
      title: 'Tu ubicación',
      body:
        'La app usa tu ubicación para mostrarte las líneas que pasan cerca y para avisarte cuando llegas a tu ' +
        'punto de referencia. No guardamos un historial de por dónde te mueves. Cuando publicas una alerta, sí se ' +
        'guarda el punto del mapa donde la dejaste, porque es parte del aviso.',
    },
    {
      title: 'Lo que publicas',
      body:
        'Las alertas, las calificaciones y las sugerencias que envías quedan asociadas a tu cuenta. En las ' +
        'alertas, otras personas ven tu nombre y tu foto de perfil.',
    },
    {
      title: 'Asistente y revisión de fotos',
      body:
        'Las preguntas que le haces al asistente y las fotos que subes se envían a un servicio de inteligencia ' +
        'artificial de Google (Gemini) para responderte y para comprobar que la foto es apropiada. No envíes ahí ' +
        'datos personales o sensibles.',
    },
    {
      title: 'Con quién compartimos',
      body:
        'No vendemos ni alquilamos tus datos. Usamos proveedores para funcionar: el servidor y la base de datos ' +
        '(Supabase), el alojamiento de la web (Cloudflare) y los mapas (OpenStreetMap).',
    },
    {
      title: 'Tus derechos',
      body:
        'Puedes pedir que corrijamos o eliminemos tu cuenta y tus datos cuando quieras, conforme a la Ley de ' +
        'Protección de Datos Personales del Perú (Ley N.º 29733). Escríbenos desde Contacto y lo atendemos.',
    },
  ],
};

const TERMS: LegalText = {
  title: 'Las reglas para usar Subo',
  lead: 'Al usar Subo aceptas estas condiciones. Son pocas y están pensadas para que el servicio le sirva a todos.',
  summary: [],
  sections: [
    {
      title: 'La información es una guía',
      body:
        'Los recorridos, horarios y pasajes son referenciales. Las empresas de transporte pueden cambiarlos sin ' +
        'aviso, y Subo no opera ningún micro. Confirma en el punto de referencia cuando tengas dudas.',
    },
    {
      title: 'Tu cuenta',
      body:
        'Eres responsable de lo que se hace con tu cuenta. Usa una contraseña que no compartas y avísanos si ' +
        'crees que alguien más entró con ella.',
    },
    {
      title: 'Lo que publicas',
      body:
        'Publica solo avisos reales y relacionados con el transporte y la calle. No se permite contenido falso, ' +
        'ofensivo, violento u obsceno, ni datos personales de otras personas. Podemos retirar publicaciones y ' +
        'suspender cuentas que no respeten esto.',
    },
    {
      title: 'Uso correcto',
      body:
        'No intentes entrar a partes del servicio que no te corresponden, ni copiar el catálogo de forma masiva, ' +
        'ni interferir con su funcionamiento.',
    },
    {
      title: 'Cambios',
      body:
        'Podemos actualizar estos términos y el servicio. Si el cambio es importante, lo avisaremos en la app o ' +
        'en esta web.',
    },
  ],
};

/**
 * Una página legal: arriba se cambia entre Privacidad y Términos, a la
 * izquierda va el índice y, a la derecha, el texto.
 */
@Component({
  imports: [RouterLink],
  selector: 'app-legal',
  styleUrl: './legal.css',
  templateUrl: './legal.html',
})
export class Legal {
  /** Cuál de las dos se está leyendo; lo dice la ruta. */
  readonly page = input<'privacy' | 'terms'>('privacy');

  protected readonly text = computed(() => (this.page() === 'terms' ? TERMS : PRIVACY));

  /** El apartado al que se saltó desde el índice. */
  protected readonly current = signal(0);

  private readonly anchors = viewChildren<ElementRef<HTMLElement>>('anchor');

  protected jump(index: number): void {
    this.current.set(index);
    this.anchors()[index]?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
