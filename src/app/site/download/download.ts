import { Component } from '@angular/core';

import { SiteInfo } from '../../core/site-info';

/** De dónde se baja la app de Android y cómo se instala. */
@Component({
  selector: 'app-download',
  styleUrl: './download.css',
  templateUrl: './download.html',
})
export class Download {
  /** Dónde está el archivo; vacío si la descarga todavía no está lista. */
  protected readonly apkUrl = SiteInfo.apkUrl;

  protected readonly details = [
    'Para Android',
    ...(SiteInfo.apkVersion === '' ? [] : [`Versión ${SiteInfo.apkVersion}`]),
    ...(SiteInfo.apkSize === '' ? [] : [SiteInfo.apkSize]),
  ].join(' · ');

  /** Lo que solo tiene la app. */
  protected readonly gains = [
    {
      icon: 'near_me',
      title: 'Líneas cerca de ti',
      body: 'Abre la app y mira qué micros pasan por donde estás parado.',
    },
    {
      icon: 'route',
      title: '¿A dónde vas?',
      body: 'Busca un lugar y te dice qué micro tomar, dónde subir y cuánto caminar.',
    },
    {
      icon: 'notifications',
      title: 'Aviso de llegada',
      body: 'Te avisa cuando estás por llegar, para que no te pases.',
    },
  ];

  protected readonly steps = [
    {
      title: 'Descarga el archivo',
      body: 'Toca el botón de arriba desde tu celular Android. Se baja un archivo que termina en .apk.',
    },
    {
      title: 'Permite la instalación',
      body: 'Al abrirlo, Android te pedirá permiso para instalar apps de este origen. Acéptalo.',
    },
    {
      title: 'Entra con tu cuenta',
      body: 'Abre Subo y usa la misma cuenta que en la web, o crea una ahí mismo.',
    },
  ];
}
