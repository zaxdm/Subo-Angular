import { GeoPoint } from './models';

/** Un sitio y el margen de error, en metros, con el que se conoce. */
export interface Fix extends GeoPoint {
  accuracy: number;
}

/**
 * Pregunta al navegador dónde está el dispositivo. `null` si la persona no da
 * permiso o el navegador no lo averigua a tiempo.
 */
export function currentLocation(): Promise<Fix | null> {
  return new Promise((resolve) => {
    try {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
      );
    } catch {
      resolve(null);
    }
  });
}
