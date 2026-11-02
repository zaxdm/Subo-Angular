/**
 * El contenido de una etiqueta del mapa como texto. Leaflet mete con innerHTML
 * lo que le llega como texto, y los nombres de rutas y paraderos los escribe la
 * gente: dárselo como elemento con `textContent` impide que alguien cuele código.
 */
export function mapTip(text: string): HTMLElement {
  const element = document.createElement('span');
  element.textContent = text;
  return element;
}
