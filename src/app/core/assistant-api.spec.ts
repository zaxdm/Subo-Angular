import { vi } from 'vitest';

import { Api } from './api';

describe('API del asistente', () => {
  const request = vi.fn();
  const reply = (data: unknown) => request.mockResolvedValue({ ok: true, text: async () => JSON.stringify(data) });
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', request);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lee reglas sin cuota y conserva la compatibilidad con routeId', async () => {
    reply({ answer: 'Toma la M-02.', routeId: 'm02', source: 'reglas' });
    expect(await new Api().ask('Tecsup')).toEqual({ text: 'Toma la M-02.', routeIds: ['m02'], source: 'reglas' });
    reply({ answer: 'Hola.', routeIds: [], remaining: 3, source: 'ia' });
    expect(await new Api().ask('Hola')).toMatchObject({ remaining: 3, source: 'ia' });
  });

  it('descarta fuentes desconocidas y campos opcionales inválidos', async () => {
    reply({ answer: 'Hola.', routeIds: ['real', null], remaining: 'cinco', source: 'otro' });
    expect(await new Api().ask('Hola')).toEqual({ text: 'Hola.', routeIds: ['real'] });
  });

  it('usa las listas y fechas del contrato administrativo', async () => {
    const api = new Api();
    reply({
      items: [
        {
          id: 'f1',
          question: 'Pregunta',
          variants: ['variante', 1],
          answer: 'Respuesta',
          active: false,
          createdAt: 10,
          updatedAt: 20,
        },
      ],
    });
    expect(await api.assistantFaqs()).toEqual([
      {
        id: 'f1',
        question: 'Pregunta',
        variants: ['variante'],
        answer: 'Respuesta',
        active: false,
        createdAt: new Date(10),
        updatedAt: new Date(20),
      },
    ]);
    reply({
      items: [{ id: 'm1', question: 'Pendiente', normalized: 'pendiente', times: 4, lastAt: 30, answered: false }],
    });
    expect(await api.assistantMisses()).toEqual([
      { id: 'm1', question: 'Pendiente', normalized: 'pendiente', times: 4, lastAt: new Date(30), answered: false },
    ]);
  });

  it('responde una pregunta pendiente con el cuerpo de la FAQ', async () => {
    reply({ id: 'f1' });
    const draft = { question: 'Pregunta', variants: ['Otra forma'], answer: 'Respuesta', active: true };
    await new Api().answerAssistantMiss('m/1', draft);
    expect(request).toHaveBeenCalledWith(
      expect.stringContaining('/api/admin/assistant/misses/m%2F1/answer'),
      expect.objectContaining({ method: 'POST', body: JSON.stringify(draft) }),
    );
  });
});
