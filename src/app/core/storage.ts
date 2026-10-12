// Lo que se guarda en este navegador. La web anterior, hecha en Flutter,
// guardaba lo mismo con el prefijo `flutter.` y el texto entre comillas: se
// sigue leyendo para que nadie pierda su sesión ni sus favoritos al cambiar.

const PREFIX = 'subo.';
const LEGACY_PREFIX = 'flutter.';

/** Lo guardado con [key]; `null` si no hay nada o no se puede leer. */
export function load(key: string): string | null {
  try {
    const value = localStorage.getItem(PREFIX + key);
    if (value !== null) return value;
    const legacy = localStorage.getItem(LEGACY_PREFIX + key);
    const decoded: unknown = legacy === null ? null : JSON.parse(legacy);
    return typeof decoded === 'string' ? decoded : null;
  } catch {
    // Sin almacenamiento (una ventana privada, por ejemplo) no hay nada que recuperar.
    return null;
  }
}

/** Guarda [value] con [key], o lo borra si es `null`. */
export function save(key: string, value: string | null): void {
  try {
    localStorage.removeItem(LEGACY_PREFIX + key);
    if (value === null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, value);
  } catch {
    // Sin almacenamiento, lo guardado dura lo que dure la página abierta.
  }
}
