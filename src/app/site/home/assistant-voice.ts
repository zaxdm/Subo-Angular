import { signal } from '@angular/core';

import { load, save } from '../../core/storage';

/** Tipos mínimos: algunos navegadores exponen solo la versión con prefijo. */
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}

type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};

/** Voz del navegador, sin claves ni servicios propios. */
export class AssistantVoice {
  private readonly browser = typeof window === 'undefined' ? null : (window as SpeechWindow);
  private readonly Recognition = this.browser?.SpeechRecognition ?? this.browser?.webkitSpeechRecognition;
  readonly canListen = this.Recognition !== undefined;
  readonly canSpeak =
    this.browser !== null && 'speechSynthesis' in this.browser && typeof SpeechSynthesisUtterance !== 'undefined';
  readonly listening = signal(false);
  readonly muted = signal(load('assistant_muted') === 'true');
  private recognition: Recognition | null = null;
  private language = 'es-PE';

  constructor(
    private readonly onQuestion: (text: string) => void,
    private readonly notify: (message: string) => void,
  ) {}

  toggleListening(): void {
    if (this.listening()) this.stopListening();
    else this.listen(this.language);
  }

  private listen(language: string): void {
    if (!this.Recognition) return;
    this.stop();
    const recognition = new this.Recognition();
    this.recognition = recognition;
    recognition.lang = language;
    recognition.continuous = false;
    recognition.interimResults = false;
    let retry = false;
    recognition.onresult = (event) => {
      if (this.recognition !== recognition) return;
      const text = event.results[event.resultIndex]?.[0]?.transcript.trim();
      this.stopListening();
      if (text) this.onQuestion(text.slice(0, 500));
    };
    recognition.onerror = (event) => {
      if (this.recognition !== recognition) return;
      retry = event.error === 'language-not-supported' && language === 'es-PE';
      if (retry || event.error === 'aborted') return;
      this.listening.set(false);
      this.notify(
        event.error === 'not-allowed' || event.error === 'service-not-allowed'
          ? 'Permite el uso del micrófono en el navegador para preguntar con tu voz.'
          : event.error === 'no-speech'
            ? 'No escuché una pregunta. Toca el micrófono e inténtalo otra vez.'
            : 'No se pudo escuchar tu voz. Puedes escribir tu pregunta.',
      );
    };
    recognition.onend = () => {
      if (this.recognition !== recognition) return;
      this.recognition = null;
      this.listening.set(false);
      if (retry) {
        this.language = 'es-ES';
        this.listen(this.language);
      }
    };
    try {
      this.listening.set(true);
      recognition.start();
    } catch {
      this.stopListening();
      if (language === 'es-PE') {
        this.language = 'es-ES';
        this.listen(this.language);
      } else this.notify('No se pudo abrir el micrófono. Puedes escribir tu pregunta.');
    }
  }

  stopListening(): void {
    const recognition = this.recognition;
    this.recognition = null;
    this.listening.set(false);
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
    }
  }

  toggleMuted(): void {
    this.muted.update((muted) => !muted);
    save('assistant_muted', String(this.muted()));
    if (this.muted()) this.stopSpeaking();
  }

  speak(text: string): void {
    if (!this.canSpeak || this.muted() || !text.trim()) return;
    this.stopSpeaking();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = this.browser!.speechSynthesis.getVoices();
    utterance.voice =
      voices.find((voice) => voice.lang.toLowerCase() === 'es-pe') ??
      voices.find((voice) => voice.lang.toLowerCase().startsWith('es')) ??
      null;
    utterance.lang = utterance.voice?.lang ?? 'es-PE';
    this.browser!.speechSynthesis.speak(utterance);
  }

  private stopSpeaking(): void {
    if (this.canSpeak) this.browser!.speechSynthesis.cancel();
  }

  stop(): void {
    this.stopListening();
    this.stopSpeaking();
  }
}
