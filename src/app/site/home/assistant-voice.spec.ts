import { vi } from 'vitest';

import { AssistantVoice } from './assistant-voice';

class Recognition {
  static instances: Recognition[] = [];
  lang = '';
  continuous = true;
  interimResults = true;
  onresult: ((event: { resultIndex: number; results: { transcript: string }[][] }) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  abort = vi.fn();
  constructor() {
    Recognition.instances.push(this);
  }
}

class Utterance {
  lang = '';
  voice = null;
  constructor(readonly text: string) {}
}

describe('voz del asistente', () => {
  const question = vi.fn();
  const notify = vi.fn();
  const synthesis = { speak: vi.fn(), cancel: vi.fn(), getVoices: vi.fn() };

  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    Recognition.instances = [];
    vi.stubGlobal('SpeechRecognition', Recognition);
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
    vi.stubGlobal('speechSynthesis', synthesis);
    synthesis.getVoices.mockReturnValue([{ lang: 'en-US' }, { lang: 'es-ES' }, { lang: 'es-PE' }]);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('escucha en español peruano y entrega la pregunta una sola vez', () => {
    const voice = new AssistantVoice(question, notify);
    voice.toggleListening();
    const recognition = Recognition.instances[0];
    expect(recognition.lang).toBe('es-PE');
    expect(recognition.continuous).toBe(false);
    expect(voice.listening()).toBe(true);
    const result = recognition.onresult!;
    result({ resultIndex: 0, results: [[{ transcript: ' Quiero ir a Tecsup ' }]] });
    result({ resultIndex: 0, results: [[{ transcript: 'Duplicado' }]] });
    expect(question).toHaveBeenCalledExactlyOnceWith('Quiero ir a Tecsup');
    expect(voice.listening()).toBe(false);
    expect(recognition.abort).toHaveBeenCalledOnce();
  });

  it('reintenta con es-ES si el navegador no admite es-PE', () => {
    const voice = new AssistantVoice(question, notify);
    voice.toggleListening();
    Recognition.instances[0].onerror!({ error: 'language-not-supported' });
    Recognition.instances[0].onend!();
    expect(Recognition.instances[1].lang).toBe('es-ES');
    expect(voice.listening()).toBe(true);
    expect(notify).not.toHaveBeenCalled();
    voice.stop();
  });

  it('usa el prefijo webkit y explica un permiso denegado', () => {
    vi.stubGlobal('SpeechRecognition', undefined);
    vi.stubGlobal('webkitSpeechRecognition', Recognition);
    const voice = new AssistantVoice(question, notify);
    expect(voice.canListen).toBe(true);
    voice.toggleListening();
    Recognition.instances[0].onerror!({ error: 'not-allowed' });
    expect(voice.listening()).toBe(false);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Permite el uso del micrófono'));
    voice.stop();
  });

  it('mantiene la lectura en voz alta aunque no haya reconocimiento', () => {
    vi.stubGlobal('SpeechRecognition', undefined);
    vi.stubGlobal('webkitSpeechRecognition', undefined);
    const voice = new AssistantVoice(question, notify);
    expect(voice.canListen).toBe(false);
    expect(voice.canSpeak).toBe(true);
    voice.speak('Toma la ruta M-02.');
    expect(synthesis.speak).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Toma la ruta M-02.', lang: 'es-PE', voice: { lang: 'es-PE' } }),
    );
  });

  it('elige otra voz española y silencia también las respuestas siguientes', () => {
    synthesis.getVoices.mockReturnValue([{ lang: 'en-US' }, { lang: 'es-ES' }]);
    const voice = new AssistantVoice(question, notify);
    voice.speak('Hola.');
    expect(synthesis.speak).toHaveBeenCalledWith(expect.objectContaining({ lang: 'es-ES' }));
    voice.toggleMuted();
    voice.speak('No se debe leer.');
    expect(synthesis.speak).toHaveBeenCalledOnce();
    expect(synthesis.cancel).toHaveBeenCalledTimes(2);
    expect(new AssistantVoice(question, notify).muted()).toBe(true);
  });

  it('al salir corta el micrófono y la lectura', () => {
    const voice = new AssistantVoice(question, notify);
    voice.toggleListening();
    const recognition = Recognition.instances[0];
    const result = recognition.onresult!;
    voice.stop();
    result({ resultIndex: 0, results: [[{ transcript: 'Pregunta tardía' }]] });
    expect(question).not.toHaveBeenCalled();
    expect(recognition.abort).toHaveBeenCalledOnce();
    expect(voice.listening()).toBe(false);
    expect(synthesis.cancel).toHaveBeenCalled();
  });
});
