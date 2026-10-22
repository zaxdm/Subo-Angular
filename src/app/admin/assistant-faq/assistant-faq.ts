import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { Api } from '../../core/api';
import { AssistantFaqItem, AssistantMiss, formatDateTime } from '../../core/models';
import { Store } from '../../core/store';
import { Ui } from '../../core/ui';
import { PageFrame } from '../../shared/page-frame/page-frame';

const searchable = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

@Component({
  imports: [FormsModule, PageFrame],
  selector: 'app-assistant-faq',
  styleUrl: './assistant-faq.css',
  templateUrl: './assistant-faq.html',
})
export class AssistantFaq {
  private readonly api = inject(Api);
  private readonly store = inject(Store);
  private readonly ui = inject(Ui);

  protected readonly formatDateTime = formatDateTime;
  protected readonly ready = signal(false);
  protected readonly loading = signal(false);
  protected readonly tab = signal<'misses' | 'saved'>('misses');
  protected readonly faqs = signal<AssistantFaqItem[]>([]);
  protected readonly misses = signal<AssistantMiss[]>([]);
  protected readonly search = signal('');
  protected readonly pending = computed(() =>
    this.misses()
      .filter((item) => !item.answered)
      .sort((a, b) => b.times - a.times || b.lastAt.getTime() - a.lastAt.getTime()),
  );
  protected readonly shown = computed(() => {
    const query = searchable(this.search().trim());
    return this.faqs().filter((item) =>
      searchable([item.question, item.answer, ...item.variants].join(' ')).includes(query),
    );
  });

  protected readonly editing = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly answering = signal<AssistantMiss | null>(null);
  protected readonly question = signal('');
  protected readonly variants = signal('');
  protected readonly answer = signal('');
  protected readonly active = signal(true);
  protected readonly saving = signal(false);
  protected readonly changing = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    try {
      const [faqs, misses] = await Promise.all([this.api.assistantFaqs(), this.api.assistantMisses()]);
      this.faqs.set(faqs);
      this.misses.set(misses);
    } catch (error) {
      this.store.onError(error);
    } finally {
      this.ready.set(true);
      this.loading.set(false);
    }
  }

  protected open(item: AssistantFaqItem | null = null, miss: AssistantMiss | null = null): void {
    this.editingId.set(item?.id ?? null);
    this.answering.set(miss);
    this.question.set(item?.question ?? miss?.question ?? '');
    this.variants.set(item?.variants.join('\n') ?? miss?.question ?? '');
    this.answer.set(item?.answer ?? '');
    this.active.set(item?.active ?? true);
    this.editing.set(true);
  }

  protected close(): void {
    if (!this.saving()) this.editing.set(false);
  }

  protected async save(): Promise<void> {
    if (this.saving() || !this.question().trim() || !this.answer().trim()) return;
    this.saving.set(true);
    const miss = this.answering();
    const draft = {
      question: this.question().trim(),
      variants: [
        ...new Set(
          this.variants()
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
        ),
      ],
      answer: this.answer().trim(),
      active: this.active(),
    };
    try {
      const item = miss
        ? await this.api.answerAssistantMiss(miss.id, draft)
        : await this.api.saveAssistantFaq(draft, this.editingId());
      this.faqs.update((items) => [item, ...items.filter((other) => other.id !== item.id)]);
      if (miss)
        this.misses.update((items) =>
          items.map((other) => (other.id === miss.id ? { ...other, answered: true } : other)),
        );
      this.editing.set(false);
      this.ui.notify('Respuesta guardada. El asistente ya puede usarla.');
    } catch (error) {
      this.store.onError(error);
    } finally {
      this.saving.set(false);
    }
  }

  protected async toggle(item: AssistantFaqItem): Promise<void> {
    if (this.changing() !== null) return;
    this.changing.set(item.id);
    try {
      const saved = await this.api.saveAssistantFaq(
        { question: item.question, variants: item.variants, answer: item.answer, active: !item.active },
        item.id,
      );
      this.faqs.update((items) => items.map((other) => (other.id === saved.id ? saved : other)));
    } catch (error) {
      this.store.onError(error);
    } finally {
      this.changing.set(null);
    }
  }
}
