import {
  BusRoute,
  dashboardFromJson,
  newRoute,
  routeFromJson,
  routeToJson,
  safeUrl,
  sessionOf,
  userListFromJson,
} from './models';
import { lastSeenLabel } from '../admin/users/users';
import { groupServices } from './directions';
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
      routes: [
        {
          distance: 1234.5,
          geometry: {
            coordinates: [
              [-79.03, -8.11],
              [-79.04, -8.1],
            ],
          },
        },
      ],
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

describe('groupServices', () => {
  it('junta la ida y la vuelta de una línea y las distingue', () => {
    const ida = route();
    const vuelta = { ...duplicateRoute(ida, true), id: 'r2', name: 'Huanchaco' };
    const [line, ...rest] = groupServices([ida, vuelta]);

    expect(rest).toEqual([]);
    expect(line.routes.map((item) => item.direction)).toEqual(['Ida', 'Vuelta']);
    expect(line.routes.every((item) => item.duplicateOf === null)).toBe(true);
  });

  it('marca como repetida la ruta que hace el mismo recorrido en el mismo sentido', () => {
    const ida = route();
    const copia = { ...ida, id: 'r3' };
    const vuelta = { ...duplicateRoute(ida, true), id: 'r2', name: 'Huanchaco' };
    const line = groupServices([ida, copia, vuelta])[0];

    expect(line.routes.map((item) => item.direction)).toEqual(['Ida 1', 'Ida 2', 'Vuelta']);
    expect(line.routes[1].duplicateOf).toBe(ida);
  });

  it('una línea con un solo recorrido no lleva sentido', () => {
    expect(groupServices([route()])[0].routes[0].direction).toBe('');
  });
});

describe('panel de estadísticas', () => {
  it('lee el tablero aunque falten campos', () => {
    const data = dashboardFromJson({
      days: 7,
      totals: { users: 12, downloads: { value: 5, previous: 2 } },
      series: [{ day: '2026-10-19', android: 3, web: 1 }],
      recentUsers: [{ id: 'u1', name: 'Ana', email: 'ana@correo.pe', createdAt: 1, lastPlatform: 'ios' }],
    });

    expect(data.totals.users).toBe(12);
    expect(data.totals.downloads).toEqual({ value: 5, previous: 2 });
    expect(data.totals.alerts).toEqual({ value: 0, previous: 0 });
    expect(data.series[0]).toEqual({
      day: '2026-10-19',
      android: 3,
      web: 1,
      signedIn: 0,
      newUsers: 0,
      downloads: 0,
      alerts: 0,
    });
    expect(data.recentUsers[0].lastPlatform).toBeNull();
    expect(data.trackingSince).toBeNull();
  });

  it('cuenta las cuentas de cada filtro', () => {
    const list = userListFromJson({ users: [], total: 0, counts: { all: 9, blocked: 1 } });
    expect(list.counts.all).toBe(9);
    expect(list.counts.blocked).toBe(1);
    expect(list.counts.premium).toBe(0);
  });

  it('dice cuándo entró alguien como lo diría una persona', () => {
    const now = Date.UTC(2026, 9, 19, 15);
    expect(lastSeenLabel(now - 30_000, now)).toBe('ahora');
    expect(lastSeenLabel(now - 5 * 60_000, now)).toBe('hace 5 min');
    expect(lastSeenLabel(now - 3 * 3_600_000, now)).toBe('hace 3 h');
    expect(lastSeenLabel(now - 30 * 3_600_000, now)).toBe('ayer');
    expect(lastSeenLabel(now - 4 * 86_400_000, now)).toBe('hace 4 días');
    expect(lastSeenLabel(Date.UTC(2026, 6, 2, 15), now)).toBe('2 jul 2026');
  });
});
