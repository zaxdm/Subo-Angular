import { BusRoute, newRoute, routeFromJson, routeToJson, safeUrl, sessionOf } from './models';
import { metersToLine } from './nearby';
import { duplicateRoute, parseStreetPath, streetUrl } from './route-tools';

const route = (): BusRoute => ({
  ...newRoute(),
  id: 'r1',
  name: 'Huanchaco',
  letter: 'H',
  origin: 'Centro',
  destination: 'Huanchaco',
  status: 'APPROVED',
  stops: [
    { name: 'Plaza', latitude: -8.11, longitude: -79.03 },
    { name: 'Muelle', latitude: -8.08, longitude: -79.12 },
  ],
  path: [
    { latitude: -8.11, longitude: -79.03 },
    { latitude: -8.1, longitude: -79.07 },
    { latitude: -8.08, longitude: -79.12 },
  ],
});

describe('metersToLine', () => {
  const line = [
    { latitude: 0, longitude: 0 },
    { latitude: 0, longitude: 0.01 },
  ];

  it('mide hasta el tramo, no hasta sus extremos', () => {
    expect(metersToLine({ latitude: 0.001, longitude: 0.005 }, line)).toBeCloseTo(111.32, 1);
  });

  it('pasado el final, mide hasta el último punto', () => {
    expect(metersToLine({ latitude: 0, longitude: 0.011 }, line)).toBeCloseTo(111.32, 1);
  });

  it('una línea sin puntos queda infinitamente lejos', () => {
    expect(metersToLine({ latitude: 0, longitude: 0 }, [])).toBe(Infinity);
  });
});

describe('duplicateRoute', () => {
  it('la copia queda sin guardar y pendiente', () => {
    const copy = duplicateRoute(route());
    expect(copy.id).toBeNull();
    expect(copy.status).toBe('PENDING');
    expect(copy.name).toBe('Huanchaco (copia)');
    expect(copy.stops.map((stop) => stop.name)).toEqual(['Plaza', 'Muelle']);
  });

  it('la vuelta invierte el recorrido y cambia origen y destino', () => {
    const original = route();
    const back = duplicateRoute(original, true);
    expect(back.name).toBe('Huanchaco (vuelta)');
    expect(back.origin).toBe('Huanchaco');
    expect(back.destination).toBe('Centro');
    expect(back.bidirectional).toBe(false);
    expect(back.stops.map((stop) => stop.name)).toEqual(['Muelle', 'Plaza']);
    expect(back.path[0]).toEqual(original.path[2]);
    // La original no se toca.
    expect(original.stops[0].name).toBe('Plaza');
  });
});

describe('trazado por las calles', () => {
  it('pide las coordenadas como longitud,latitud', () => {
    expect(streetUrl(route().stops)).toContain('/-79.030000,-8.110000;-79.120000,-8.080000?overview=full');
  });

  it('lee el camino de la respuesta', () => {
    const body = JSON.stringify({
      code: 'Ok',
      routes: [{ distance: 1234.5, geometry: { coordinates: [[-79.03, -8.11], [-79.04, -8.1]] } }],
    });
    expect(parseStreetPath(body)).toEqual({
      points: [
        { latitude: -8.11, longitude: -79.03 },
        { latitude: -8.1, longitude: -79.04 },
      ],
      meters: 1234.5,
    });
  });

  it('una respuesta sin camino no vale', () => {
    expect(parseStreetPath('{"code":"NoRoute"}')).toBeNull();
    expect(parseStreetPath('no es JSON')).toBeNull();
  });
});

describe('modelos', () => {
  it('una ruta va y vuelve del formato del servidor sin perder nada', () => {
    const original = route();
    expect(routeFromJson({ ...routeToJson(original), id: original.id })).toEqual(original);
  });

  it('un trazado de menos de dos puntos no se manda', () => {
    expect(routeToJson({ ...route(), path: [{ latitude: 0, longitude: 0 }] })['path']).toBeNull();
  });

  it('solo las fotos HTTPS son seguras de cargar', () => {
    expect(safeUrl('https://subo.pe/a.jpg')).toBe('https://subo.pe/a.jpg');
    expect(safeUrl('http://subo.pe/a.jpg')).toBeNull();
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl(null)).toBeNull();
  });

  it('el rol del servidor decide si la cuenta es de administrador', () => {
    const passenger = { name: 'Ana', isAdmin: false, isSuperAdmin: false, email: 'ana@subo.pe', avatarUrl: 'a.jpg' };
    expect(sessionOf({ role: 'super_admin' }, passenger)).toMatchObject({ isAdmin: true, isSuperAdmin: true });
    expect(sessionOf({ role: 'admin' }, passenger)).toMatchObject({ isAdmin: true, isSuperAdmin: false });
    // Lo que el servidor no dice se conserva; una foto quitada, no.
    expect(sessionOf({}, passenger)).toEqual(passenger);
    expect(sessionOf({ avatarUrl: null }, passenger).avatarUrl).toBeNull();
  });
});
