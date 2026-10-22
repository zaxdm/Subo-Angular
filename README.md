# Subo · web

La web de Subo, hecha con [Angular](https://angular.dev) (proyecto creado con `ng new`). Tiene dos partes que
comparten un solo acceso:

- **La web de los pasajeros**: la portada, el mapa con las líneas, la descarga de la app, Privacidad, Términos,
  Contacto y Mi perfil.
- **El panel de administración** (`/panel`): el catálogo de rutas con su editor, la moderación de alertas, el buzón
  de sugerencias, las estadísticas y los administradores.

Habla con el mismo servidor que la app (la función `server` de Supabase, en `../backend`).

En `/panel/asistente`, un administrador puede responder las preguntas pendientes más repetidas,
crear respuestas guardadas con variantes, buscarlas, editarlas y activarlas o desactivarlas.
El servidor consulta esas respuestas antes del respaldo de IA.

El asistente de pasajeros admite dictado cuando el navegador ofrece reconocimiento de voz y puede
leer las respuestas en español. El botón de sonido permite silenciarlo; la preferencia se conserva.
Si no hay reconocimiento, se puede escribir y seguir escuchando las respuestas.

## Para trabajar

```bash
npm install
npm start        # http://localhost:4200, se recarga al guardar
npm test         # pruebas (Vitest)
npm run build    # deja la web lista en dist/subo-web/browser
```

Las piezas nuevas se crean con el CLI: `ng generate component site/mi-pagina`.

## Dónde está cada cosa

| Carpeta          | Qué hay                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `src/app/core`   | El cliente del servidor (`api.ts`), los datos (`models.ts`), el estado compartido (`store.ts`) y los avisos (`ui.ts`). |
| `src/app/site`   | Las páginas de los pasajeros y su marco (barra de arriba y pie).                                                       |
| `src/app/admin`  | Las secciones del panel y su marco (barra lateral).                                                                    |
| `src/app/shared` | Lo que usan las dos partes: el acceso, Mi perfil, el logo…                                                             |
| `src/styles.css` | La paleta de Subo y las piezas comunes: botones, campos, tarjetas.                                                     |
| `public`         | Lo que se copia tal cual: iconos, letras, las fotos de `nosotros/` y la app en `descargas/subo.apk`.                   |

## Qué se cambia a menudo

- **Datos de contacto, la descarga de la app y la dirección del servidor**: `src/app/core/site-info.ts`.
- **Fotos de la portada**: `public/nosotros/` (`galeria-1.jpg`, `galeria-2.jpg`, `galeria-3.jpg`, `equipo.jpg`,
  `app.jpg`). Mientras una no exista, en su lugar se ve un recuadro amarillo.
- **El acceso con Google**: en Google Cloud, el cliente OAuth tiene que tener autorizada la dirección de la web
  como «origen de JavaScript». En `localhost` el botón de Google no entra si ese origen no está en la lista.

## Publicar

`wrangler.jsonc` publica `dist/subo-web/browser` en Cloudflare como sitio estático. La dirección `/ruta/<id>` es la
que comparte la app: no cambiarla sin cambiarla también allí.
