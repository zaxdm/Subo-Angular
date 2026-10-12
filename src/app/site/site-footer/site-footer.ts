import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { contactChannels } from '../../core/site-info';
import { SuboMark } from '../../shared/subo-mark/subo-mark';

/**
 * El pie completo, al final de las páginas de texto: la marca, las páginas
 * del sitio y cómo escribirle a Subo.
 */
@Component({
  imports: [RouterLink, SuboMark],
  selector: 'app-site-footer',
  styleUrl: './site-footer.css',
  templateUrl: './site-footer.html',
})
export class SiteFooter {
  protected readonly channels = contactChannels().filter((channel) => channel.link !== null);
}
