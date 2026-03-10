import { bootstrapApplication } from '@angular/platform-browser';
import { LOCALE_ID } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';

import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

registerLocaleData(localeEs);

bootstrapApplication(AppComponent, {
  ...appConfig,
  providers: [
    ...(appConfig.providers ?? []),
    { provide: LOCALE_ID, useValue: 'es-ES' }
  ]
}).catch(console.error);