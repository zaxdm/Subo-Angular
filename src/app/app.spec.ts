import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { App } from './app';
import { mapMatcher } from './app.routes';
import { Store } from './core/store';
import { Ui } from './core/ui';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('enseña la ventana de acceso solo cuando se pide', async () => {
    const fixture = TestBed.createComponent(App);
    const page = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
    expect(page.querySelector('app-login')).toBeNull();

    TestBed.inject(Store).openLogin();
    await fixture.whenStable();
    expect(page.querySelector('app-login')).not.toBeNull();
  });

  it('enseña los avisos al pie', async () => {
    const fixture = TestBed.createComponent(App);
    TestBed.inject(Ui).notify('Ruta guardada.');
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('.toast')?.textContent).toContain('Ruta guardada.');
    TestBed.inject(Ui).dismissToast();
  });
});

describe('mapMatcher', () => {
  const segments = (path: string) => path.split('/').map((part) => ({ path: part }) as never);

  it('atiende el mapa y el enlace compartido de una línea', () => {
    expect(mapMatcher(segments('mapa'))?.posParams).toBeUndefined();
    expect(mapMatcher(segments('ruta/abc'))?.posParams?.['id'].path).toBe('abc');
  });

  it('deja pasar las demás direcciones', () => {
    expect(mapMatcher(segments('contacto'))).toBeNull();
    expect(mapMatcher(segments('ruta'))).toBeNull();
    expect(mapMatcher(segments('ruta/abc/extra'))).toBeNull();
  });
});
