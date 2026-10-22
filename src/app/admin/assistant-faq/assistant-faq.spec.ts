import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { Api } from '../../core/api';
import { AssistantFaqItem, AssistantMiss } from '../../core/models';
import { Store } from '../../core/store';
import { Ui } from '../../core/ui';
import { AssistantFaq } from './assistant-faq';

describe('AssistantFaq', () => {
  let fixture: ComponentFixture<AssistantFaq>;
  let page: HTMLElement;
  const faq: AssistantFaqItem = {
    id: 'faq1',
    question: '¿Cómo reporto un choque?',
    variants: ['Alerta de accidente'],
    answer: 'Abre Alertas y elige Accidente.',
    active: true,
    createdAt: new Date(1),
    updatedAt: new Date(2),
  };
  const miss = (id: string, times: number): AssistantMiss => ({
    id,
    question: `Pregunta ${id}`,
    normalized: `pregunta ${id}`,
    times,
    lastAt: new Date(3),
    answered: false,
  });
  const api = {
    assistantFaqs: vi.fn(),
    assistantMisses: vi.fn(),
    saveAssistantFaq: vi.fn(),
    answerAssistantMiss: vi.fn(),
  };
  const store = { onError: vi.fn() };
  const ui = { notify: vi.fn() };

  const click = async (text: string) => {
    const button = Array.from(page.querySelectorAll('button')).find((item) => item.textContent?.includes(text));
    expect(button, `Botón ${text}`).toBeDefined();
    button!.click();
    await fixture.whenStable();
  };
  const fill = (selector: string, value: string) => {
    const field = page.querySelector<HTMLInputElement>(selector)!;
    field.value = value;
    field.dispatchEvent(new Event('input'));
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    api.assistantFaqs.mockResolvedValue([faq]);
    api.assistantMisses.mockResolvedValue([miss('poco', 2), miss('mucho', 9)]);
    await TestBed.configureTestingModule({
      imports: [AssistantFaq],
      providers: [
        { provide: Api, useValue: api },
        { provide: Store, useValue: store },
        { provide: Ui, useValue: ui },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AssistantFaq);
    page = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  it('pone las preguntas más repetidas primero', () => {
    expect(Array.from(page.querySelectorAll('h3')).map((item) => item.textContent)).toEqual([
      'Pregunta mucho',
      'Pregunta poco',
    ]);
  });

  it('prellena la pregunta y al responder la quita de pendientes', async () => {
    api.answerAssistantMiss.mockResolvedValue({ ...faq, question: 'Pregunta mucho' });
    await click('Responder');
    expect(page.querySelector<HTMLInputElement>('#faq-question')?.value).toBe('Pregunta mucho');
    expect(page.querySelector<HTMLTextAreaElement>('#faq-variants')?.value).toBe('Pregunta mucho');
    fill('#faq-answer', 'Una respuesta comprobada.');
    await fixture.whenStable();
    page.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await fixture.whenStable();
    expect(api.answerAssistantMiss).toHaveBeenCalledWith('mucho', {
      question: 'Pregunta mucho',
      variants: ['Pregunta mucho'],
      answer: 'Una respuesta comprobada.',
      active: true,
    });
    expect(page.querySelector('[role="dialog"]')).toBeNull();
    expect(page.querySelector('.list')?.textContent).not.toContain('Pregunta mucho');
  });

  it('conserva el formulario cuando guardar falla', async () => {
    const error = new Error('Sin conexión');
    api.answerAssistantMiss.mockRejectedValue(error);
    await click('Responder');
    fill('#faq-answer', 'Respuesta pendiente de guardar.');
    await fixture.whenStable();
    page.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await fixture.whenStable();
    expect(store.onError).toHaveBeenCalledWith(error);
    expect(page.querySelector<HTMLTextAreaElement>('#faq-answer')?.value).toBe('Respuesta pendiente de guardar.');
  });

  it('busca sin tildes y permite desactivar una respuesta', async () => {
    api.saveAssistantFaq.mockResolvedValue({ ...faq, active: false });
    await click('Respuestas guardadas');
    fill('[type="search"]', 'como reporto');
    await fixture.whenStable();
    expect(page.querySelector('.list')?.textContent).toContain(faq.question);
    await click('Desactivar');
    expect(api.saveAssistantFaq).toHaveBeenCalledWith(
      { question: faq.question, variants: faq.variants, answer: faq.answer, active: false },
      'faq1',
    );
    expect(page.querySelector('.card.inactive')).not.toBeNull();
  });

  it('edita una respuesta guardada sin crear otra', async () => {
    api.saveAssistantFaq.mockResolvedValue({ ...faq, answer: 'Respuesta actualizada.' });
    await click('Respuestas guardadas');
    await click('Editar');
    fill('#faq-answer', 'Respuesta actualizada.');
    await fixture.whenStable();
    page.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    await fixture.whenStable();
    expect(api.saveAssistantFaq).toHaveBeenCalledWith(
      expect.objectContaining({ answer: 'Respuesta actualizada.' }),
      'faq1',
    );
    expect(page.querySelectorAll('article')).toHaveLength(1);
  });
});
