/**
 * Los datos de Subo que se enseñan en la web.
 *
 * Un dato de contacto vacío se muestra como «Pronto»: basta escribirlo aquí
 * para que aparezca en Contacto y en el pie de página.
 */
export const SiteInfo = {
  /** Dirección del servidor de Subo (la función `server` de Supabase). */
  serverUrl: 'https://ibgbrgeesrtrytmtygtz.supabase.co/functions/v1/server',

  /**
   * El cliente OAuth de tipo Web de Google, el mismo que usa la app. No es un
   * secreto: va en la página. En Google Cloud tiene que tener autorizada la
   * dirección de esta web como «origen de JavaScript».
   */
  googleClientId: '608487070231-84hnjf4mr3rollfpdat0ev4vqa5ud6ot.apps.googleusercontent.com',

  /** Correo al que escribe la gente. */
  email: '',

  /** WhatsApp con el código del país y sin espacios ni signos: 51987654321. */
  whatsapp: '',

  /** Direcciones completas de las redes (https://…). */
  facebook: '',
  instagram: '',
  tiktok: '',

  /**
   * Dónde se descarga la app de Android. Lo más simple: copiar el archivo a
   * `public/descargas/subo.apk` y poner aquí `descargas/subo.apk`. También vale
   * una dirección completa (https://…). Vacío: «Disponible pronto».
   */
  apkUrl: 'descargas/subo.apk',

  /**
   * Lo que se enseña junto al botón, por ejemplo `1.0` y `18 MB`. Al subir un
   * instalador nuevo hay que poner también su versión en
   * `public/descargas/version.json`: de ahí saca la app que hay una actualización.
   */
  apkVersion: '1.6',
  apkSize: '4 MB',
};

/** Un medio para escribirle a Subo: el correo, WhatsApp o una red. */
export interface ContactChannel {
  label: string;
  icon: string;

  /** Lo que se lee; vacío si todavía no se definió. */
  value: string;

  /** A dónde lleva al tocarlo; `null` si todavía no se definió. */
  link: string | null;
}

function network(label: string, icon: string, url: string): ContactChannel {
  try {
    const link = new URL(url);
    return { label, icon, value: link.host + link.pathname, link: url };
  } catch {
    return { label, icon, value: '', link: null };
  }
}

/** Los medios de [SiteInfo], estén ya definidos o no. */
export const contactChannels = (): ContactChannel[] => [
  {
    label: 'Correo',
    icon: 'mail',
    value: SiteInfo.email,
    link: SiteInfo.email === '' ? null : `mailto:${SiteInfo.email}`,
  },
  {
    label: 'WhatsApp',
    icon: 'chat',
    value: SiteInfo.whatsapp === '' ? '' : `+${SiteInfo.whatsapp}`,
    link: SiteInfo.whatsapp === '' ? null : `https://wa.me/${SiteInfo.whatsapp}`,
  },
  network('Facebook', 'facebook', SiteInfo.facebook),
  network('Instagram', 'camera_alt', SiteInfo.instagram),
  network('TikTok', 'music_note', SiteInfo.tiktok),
];
