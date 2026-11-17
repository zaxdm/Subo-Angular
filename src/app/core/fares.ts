import { BusRoute } from './models';

/** Qué pasaje paga quien viaja: el general o uno reducido. */
export type Rider = 'general' | 'university' | 'school';

export const RIDERS: { code: Rider; label: string }[] = [
  { code: 'general', label: 'General' },
  { code: 'university', label: 'Universitario' },
  { code: 'school', label: 'Escolar' },
];

/**
 * El pasaje de [route] para [rider]. Si la ruta no tiene guardado el reducido,
 * se cobra el medio pasaje que manda la ley: la mitad, redondeada a los diez
 * céntimos de arriba, como se cobra en el micro.
 */
export function fareFor(route: BusRoute, rider: Rider): number {
  if (rider === 'general') return route.fare;
  const reduced = rider === 'school' ? route.fareSchool : route.fareUniversity;
  return reduced ?? Math.ceil((route.fare / 2) * 10) / 10;
}

/** Lo que se paga por todos los micros de un viaje. */
export const totalFare = (routes: BusRoute[], rider: Rider): number =>
  Math.round(routes.reduce((sum, route) => sum + fareFor(route, rider), 0) * 100) / 100;

/**
 * Lo que costaría el mismo viaje en taxi en Trujillo, a ojo: una bajada de
 * bandera y un tanto por kilómetro, con las calles un tercio más largas que la
 * línea recta. Es para comparar, no una tarifa: se enseña como «aprox.».
 */
const TAXI_START = 3;
const TAXI_PER_KM = 1.5;
const TAXI_MINIMUM = 5;
const STREETS_LONGER = 1.35;

export function taxiEstimate(straightMeters: number): number {
  const km = (straightMeters * STREETS_LONGER) / 1000;
  return Math.max(TAXI_MINIMUM, Math.round(TAXI_START + TAXI_PER_KM * km));
}
