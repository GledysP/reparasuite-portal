import { Routes } from '@angular/router';
import { LoginComponent } from './features/login/login.component';
import { RegisterComponent } from './features/register/register.component';
//import { PortalComponent } from './features/portal/portal.component';
import { authGuard } from './core/auth.guard';
import { PortalLayoutComponent } from './features/portal-layout/portal-layout.component';
import { PortalHomeComponent } from './features/portal-home/portal-home.component';
import { PortalSuccessComponent } from './features/portal-success/portal-success.component';
import { PortalOrderComponent } from './features/portal-order/portal-order.component';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'auth/register', component: RegisterComponent },
  { path: 'register', redirectTo: 'auth/register', pathMatch: 'full' },
//  { path: 'app', component: PortalComponent, canActivate: [authGuard] }, // Componente viejo (lo borraremos al final)
  
  // NUEVA ESTRUCTURA
  {
    path: 'portal',
    component: PortalLayoutComponent,
    canActivate: [authGuard], // ¡Protegido!
    children: [
      { path: '', component: PortalHomeComponent },
      { path: 'exito', component: PortalSuccessComponent },
      { path: 'orden/:codigo', component: PortalOrderComponent },
    ]
  },

  { path: '', pathMatch: 'full', redirectTo: 'portal' }, // Redirigimos al nuevo por defecto
  { path: '**', redirectTo: 'portal' } // El comodín SIEMPRE va de último
];
