import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { Api } from '../../core/api';
import { AdminUser, USER_FILTERS, USER_SORTS, UserFilter, UserList, UserSort } from '../../core/models';
import { Store } from '../../core/store';
import { PageFrame } from '../../shared/page-frame/page-frame';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "hace 5 min", "ayer", "12 oct 2026": cuándo pasó algo, dicho como lo diría alguien. */
export function lastSeenLabel(at: number, now = Date.now()): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'ayer';
  if (days < 7) return `hace ${days} días`;
  const date = new Date(at);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

const PAGE_SIZE = 25;

/** Lo más que se exporta de una vez a CSV. */
const EXPORT_LIMIT = 500;

/**
 * Las cuentas de Subo: quién se registró, cuándo entró por última vez y desde
 * dónde, qué aporta, con búsqueda, filtros y la opción de bloquear.
 */
@Component({
  imports: [FormsModule, PageFrame],
  selector: 'app-users',
  styleUrl: './users.css',
  templateUrl: './users.html',
})
export class Users {
  private readonly api = inject(Api);
  private readonly store = inject(Store);

  protected readonly filters = USER_FILTERS;
  protected readonly sorts = USER_SORTS;
  protected readonly lastSeen = lastSeenLabel;

  protected readonly search = signal('');
  protected readonly filter = signal<UserFilter>('all');
  protected readonly sort = signal<UserSort>('recent');
  protected readonly page = signal(0);

  protected readonly list = signal<UserList | null>(null);
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);
  protected readonly exporting = signal(false);
  /** La cuenta que se está bloqueando o desbloqueando. */
  protected readonly busy = signal<string | null>(null);

  protected readonly pages = computed(() => Math.max(1, Math.ceil((this.list()?.total ?? 0) / PAGE_SIZE)));
  protected readonly from = computed(() => (this.list()?.total ? this.page() * PAGE_SIZE + 1 : 0));
  protected readonly to = computed(() => Math.min(this.list()?.total ?? 0, (this.page() + 1) * PAGE_SIZE));

  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    void this.load();
  }

  protected typed(value: string): void {
    this.search.set(value);
    clearTimeout(this.searchTimer);
    // Se espera a que deje de escribir para no pedir una lista por letra.
    this.searchTimer = setTimeout(() => this.reload(), 300);
  }

  protected chooseFilter(filter: UserFilter): void {
    this.filter.set(filter);
    this.reload();
  }

  protected chooseSort(sort: UserSort): void {
    this.sort.set(sort);
    this.reload();
  }

  protected goTo(page: number): void {
    this.page.set(Math.min(Math.max(0, page), this.pages() - 1));
    void this.load();
  }

  private reload(): void {
    this.page.set(0);
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.list.set(await this.api.adminUsers(this.query(this.page(), PAGE_SIZE)));
      this.failed.set(false);
    } catch (error) {
      this.failed.set(this.list() === null);
      this.store.onError(error);
    } finally {
      this.loading.set(false);
    }
  }

  protected async toggleBlock(user: AdminUser): Promise<void> {
    const blocking = !user.blocked;
    if (blocking && !confirm(`¿Bloquear a ${user.name}? No podrá publicar alertas ni calificar rutas.`)) return;
    this.busy.set(user.id);
    try {
      await this.api.blockUser(user.id, blocking);
      await this.load();
    } catch (error) {
      this.store.onError(error);
    } finally {
      this.busy.set(null);
    }
  }

  /** Descarga en CSV las cuentas que muestran los filtros de ahora (hasta 500). */
  protected async exportCsv(): Promise<void> {
    this.exporting.set(true);
    try {
      const { users } = await this.api.adminUsers(this.query(0, EXPORT_LIMIT));
      const iso = (at: number | null) => (at === null ? '' : new Date(at).toISOString());
      const rows = [
        [
          'Nombre',
          'Correo',
          'Registro',
          'Última visita',
          'Plataforma',
          'Alertas',
          'Calificaciones',
          'Premium',
          'Administrador',
          'Bloqueada',
          'Correo verificado',
          'Google',
        ],
        ...users.map((user) => [
          user.name,
          user.email,
          iso(user.createdAt),
          iso(user.lastSeenAt),
          user.lastPlatform ?? '',
          String(user.alerts),
          String(user.ratings),
          user.isPremium ? 'sí' : 'no',
          user.isAdmin ? 'sí' : 'no',
          user.blocked ? 'sí' : 'no',
          user.emailVerified ? 'sí' : 'no',
          user.google ? 'sí' : 'no',
        ]),
      ];
      // Comillas en todo, y el BOM para que Excel lea bien las tildes.
      const csv = '﻿' + rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\r\n');
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      link.download = `subo-cuentas-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (error) {
      this.store.onError(error);
    } finally {
      this.exporting.set(false);
    }
  }

  private query(page: number, size: number) {
    return { search: this.search().trim(), filter: this.filter(), sort: this.sort(), page, size };
  }
}
