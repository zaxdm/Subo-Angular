type Json = Record<string, unknown>;

const text = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback);
const optionalText = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const number = (value: unknown, fallback = 0): number => (typeof value === 'number' ? value : fallback);
const optionalNumber = (value: unknown): number | null => (typeof value === 'number' ? value : null);
const list = (value: unknown): Json[] => (Array.isArray(value) ? (value as Json[]) : []);

/** Fallo con un mensaje listo para enseñar. */
export class ApiError extends Error {
  /** La sesión ya no vale: hay que volver a entrar. */
  readonly unauthorized: boolean;

  /** La cuenta existe, pero no tiene permiso para eso. */
  readonly forbidden: boolean;

  constructor(message: string, options: { unauthorized?: boolean; forbidden?: boolean } = {}) {
    super(message);
    this.unauthorized = options.unauthorized ?? false;
    this.forbidden = options.forbidden ?? false;
  }
}

/** El mensaje de [error] si es del servidor; si no, [fallback]. */
export function messageOf(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/** La cuenta con la que se entró. */
export interface Session {
  name: string;

  /** `false`: un pasajero, que no ve el panel de administración. */
  isAdmin: boolean;

  /** El administrador principal: el único que da o quita el acceso a los demás. */
  isSuperAdmin: boolean;

  /** Vacío si el servidor no lo dijo. */
  email: string;

  /** La foto de perfil; `null` si no tiene. */
  avatarUrl: string | null;
}

/** La sesión de la cuenta que describe el servidor en [user]. Lo que [user] no traiga se toma de [fallback]. */
export function sessionOf(user: Json, fallback: Session): Session {
  const role = user['role'];
  return {
    name: text(user['displayName'], fallback.name),
    isAdmin: role == null ? fallback.isAdmin : role === 'admin' || role === 'super_admin',
    isSuperAdmin: role == null ? fallback.isSuperAdmin : role === 'super_admin',
    email: text(user['email'], fallback.email),
    avatarUrl: 'avatarUrl' in user ? optionalText(user['avatarUrl']) : fallback.avatarUrl,
  };
}

/** Un punto del mapa. */
export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/** Un punto de referencia: un punto con nombre. */
export interface RouteStop extends GeoPoint {
  name: string;
}

const pointOf = (json: Json): GeoPoint => ({ latitude: number(json['latitude']), longitude: number(json['longitude']) });

/** Estados de una ruta en el catálogo, con el código que guarda el servidor. */
export type RouteStatus = 'APPROVED' | 'PENDING' | 'REJECTED';

export const ROUTE_STATUSES: { code: RouteStatus; label: string }[] = [
  { code: 'APPROVED', label: 'Publicada' },
  { code: 'PENDING', label: 'Pendiente' },
  { code: 'REJECTED', label: 'Oculta' },
];

export const routeStatusLabel = (status: RouteStatus): string =>
  ROUTE_STATUSES.find((item) => item.code === status)?.label ?? '';

/** Una ruta del catálogo, tal como la devuelve y la recibe el servidor. */
export interface BusRoute {
  /** `null` en una ruta que todavía no se guardó. */
  id: string | null;
  letter: string;
  name: string;
  vehicleName: string;
  origin: string;
  destination: string;
  durationMinutes: number;
  fare: number;

  /** Pasajes reducidos y cada cuántos minutos pasa; `null` si no se saben. */
  fareSchool: number | null;
  fareUniversity: number | null;
  frequencyMinutes: number | null;
  schedule: string;
  description: string;
  imageUrl: string | null;
  bidirectional: boolean;
  status: RouteStatus;
  stops: RouteStop[];

  /** Trazado dibujado a mano; vacío si la app debe estimarlo entre puntos de referencia. */
  path: GeoPoint[];
}

export function routeFromJson(json: Json): BusRoute {
  const status = ROUTE_STATUSES.find((item) => item.code === json['status'])?.code ?? 'APPROVED';
  const imageUrl = text(json['imageUrl']).trim();
  return {
    id: optionalText(json['id']),
    letter: text(json['letter']),
    name: text(json['name']),
    vehicleName: text(json['vehicleName']),
    origin: text(json['origin']),
    destination: text(json['destination']),
    durationMinutes: Math.trunc(number(json['durationMinutes'])),
    fare: number(json['fare']),
    fareSchool: optionalNumber(json['fareSchool']),
    fareUniversity: optionalNumber(json['fareUniversity']),
    frequencyMinutes: optionalNumber(json['frequencyMinutes']),
    schedule: text(json['schedule']),
    description: text(json['description']),
    imageUrl: imageUrl === '' ? null : imageUrl,
    bidirectional: json['bidirectional'] !== false,
    status,
    stops: list(json['stops']).map((stop) => ({ name: text(stop['name']), ...pointOf(stop) })),
    path: list(json['path']).map(pointOf),
  };
}

export function routeToJson(route: BusRoute): Json {
  return {
    letter: route.letter.trim(),
    name: route.name.trim(),
    vehicleName: route.vehicleName.trim(),
    origin: route.origin.trim(),
    destination: route.destination.trim(),
    durationMinutes: route.durationMinutes,
    fare: route.fare,
    fareSchool: route.fareSchool,
    fareUniversity: route.fareUniversity,
    frequencyMinutes: route.frequencyMinutes,
    schedule: route.schedule.trim(),
    description: route.description.trim(),
    imageUrl: route.imageUrl,
    bidirectional: route.bidirectional,
    status: route.status,
    stops: route.stops.map((stop) => ({ name: stop.name.trim(), latitude: stop.latitude, longitude: stop.longitude })),
    // Un trazado necesita al menos dos puntos; si no, la app lo estima.
    path: route.path.length >= 2 ? route.path.map(({ latitude, longitude }) => ({ latitude, longitude })) : null,
    pathSnapped: false,
  };
}

/** Una ruta en blanco, para el editor. */
export const newRoute = (): BusRoute => routeFromJson({});

/** Copia independiente, para editar sin tocar la del catálogo hasta guardar. */
export const copyRoute = (route: BusRoute): BusRoute => routeFromJson({ ...routeToJson(route), id: route.id });

/** [url] solo si es segura de cargar (HTTPS). */
export function safeUrl(url: string | null | undefined): string | null {
  try {
    return url && new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** «B · Huanchaco», o solo el nombre si la línea no tiene letra. */
export const routeTitle = (route: BusRoute): string =>
  route.letter === '' ? route.name : `${route.letter} · ${route.name}`;

const ALERT_LABELS: Record<string, string> = {
  TRAFFIC: 'Tráfico',
  ACCIDENT: 'Accidente',
  OVERCHARGE: 'Cobro de más',
  ROADWORK: 'Obras',
  CROWDED: 'Micro lleno',
  DANGER: 'Zona peligrosa',
  OTHER: 'Otro',
};

/** El tipo de una alerta, dicho como en la app. */
export const alertLabel = (type: string, fallback = 'Aviso'): string => ALERT_LABELS[type] ?? fallback;

/** Un aviso de la calle: tráfico, un accidente, obras… */
export interface CityAlert extends GeoPoint {
  id: string;
  type: string;
  label: string;
  placeName: string | null;
  comment: string | null;

  /** Cuánta gente dijo que sigue ahí. */
  confirmations: number;
}

export function alertFromJson(json: Json): CityAlert {
  const type = text(json['type']);
  return {
    id: text(json['id']),
    type,
    // «Otro» solo se dice en las estadísticas: en el mapa es un aviso sin más.
    label: type === 'OTHER' ? 'Aviso' : alertLabel(type),
    ...pointOf(json),
    placeName: optionalText(json['placeName']),
    comment: optionalText(json['comment']),
    confirmations: Math.trunc(number(json['confirmations'])),
  };
}

/** Lo que contesta el asistente y, si recomienda una línea, cuál. */
export interface AssistantAnswer {
  text: string;
  routeId: string | null;
}

/** En qué va una sugerencia del buzón, con el código que guarda el servidor. */
export type SuggestionStatus = 'NEW' | 'IN_REVIEW' | 'RESOLVED';

export const SUGGESTION_STATUSES: { code: SuggestionStatus; label: string }[] = [
  { code: 'NEW', label: 'Nueva' },
  { code: 'IN_REVIEW', label: 'En revisión' },
  { code: 'RESOLVED', label: 'Resuelta' },
];

/** Una sugerencia que alguien mandó desde Soporte en la app o desde Contacto. */
export interface Suggestion {
  id: string;
  subject: string;
  message: string;
  createdAt: Date;
  appVersion: string;
  device: string;
  status: SuggestionStatus;

  /** Lo que se le contestó; quien la escribió lo ve en la app. */
  reply: string | null;

  /** `null` si la cuenta que la mandó ya no existe. */
  userName: string | null;
  userEmail: string | null;
}

export function suggestionFromJson(json: Json): Suggestion {
  return {
    id: text(json['id']),
    subject: text(json['subject']),
    message: text(json['message']),
    createdAt: new Date(number(json['createdAt'])),
    appVersion: text(json['appVersion']),
    device: text(json['device']),
    status: SUGGESTION_STATUSES.find((item) => item.code === json['status'])?.code ?? 'NEW',
    reply: optionalText(json['reply']),
    userName: optionalText(json['userName']),
    userEmail: optionalText(json['userEmail']),
  };
}

/** Una alerta vigente, con quién la publicó: lo que hace falta para moderarla. */
export interface ModerationAlert {
  alert: CityAlert;
  authorId: string;
  createdAt: Date;
  authorName: string | null;
  authorEmail: string | null;
  authorBlocked: boolean;
  imageUrl: string | null;
  dismissals: number;

  /** TRUSTED, NEW o UNRELIABLE, según cómo le fue con sus alertas anteriores. */
  reputation: string;
}

export function moderationAlertFromJson(json: Json): ModerationAlert {
  return {
    alert: alertFromJson(json),
    authorId: text(json['authorId']),
    createdAt: new Date(number(json['createdAt'])),
    authorName: optionalText(json['authorName']),
    authorEmail: optionalText(json['authorEmail']),
    authorBlocked: json['authorBlocked'] === true,
    imageUrl: optionalText(json['imageUrl']),
    dismissals: Math.trunc(number(json['dismissals'])),
    reputation: text(json['authorReputation'], 'NEW'),
  };
}

/** El resumen de uso que enseña el panel. */
export interface Stats {
  users: number;
  newUsersThisWeek: number;
  activeAlerts: number;
  ratings: number;
  pendingRoutes: number;
  newFeedback: number;

  /** Alertas de los últimos 7 días, por tipo. */
  alertsThisWeek: Record<string, number>;

  /** Alertas de los últimos 30 días por hora del día (0-23), en hora de Perú. */
  alertsByHour: number[];

  /** Las rutas más abiertas en los últimos 30 días. */
  topRoutes: { name: string; letter: string; views: number }[];
}

export function statsFromJson(json: Json): Stats {
  const week = (json['alertsThisWeek'] ?? {}) as Record<string, unknown>;
  return {
    users: number(json['users']),
    newUsersThisWeek: number(json['newUsersThisWeek']),
    activeAlerts: number(json['activeAlerts']),
    ratings: number(json['ratings']),
    pendingRoutes: number(json['pendingRoutes']),
    newFeedback: number(json['newFeedback']),
    alertsThisWeek: Object.fromEntries(Object.entries(week).map(([type, count]) => [type, number(count)])),
    alertsByHour: (Array.isArray(json['alertsByHour']) ? json['alertsByHour'] : []).map((count) => number(count)),
    topRoutes: list(json['topRoutes']).map((route) => ({
      name: text(route['name']),
      letter: text(route['letter']),
      views: number(route['views']),
    })),
  };
}

/** Una cuenta con acceso al panel. */
export interface Admin {
  id: string;
  name: string;
  email: string;

  /** El administrador principal: a él no se le quita el acceso. */
  isPrincipal: boolean;
}

export function adminFromJson(json: Json): Admin {
  return {
    id: text(json['id']),
    name: text(json['displayName']),
    email: text(json['email']),
    isPrincipal: json['role'] === 'super_admin',
  };
}

/** "10/10/2026 16:05", en la hora de quien mira el panel. */
export function formatDateTime(date: Date): string {
  const two = (value: number) => String(value).padStart(2, '0');
  return `${two(date.getDate())}/${two(date.getMonth() + 1)}/${date.getFullYear()} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** El tipo de una foto si es de los que acepta el servidor; `null` si no. */
export function imageTypeOf(file: File): string | null {
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (allowed.includes(file.type)) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  return null;
}

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
