import { Routes } from '@angular/router';
import { LoginComponent } from './features/login/login.component';
import { PortalComponent } from './features/portal/portal.component';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'app', component: PortalComponent, canActivate: [authGuard] },
  { path: '', pathMatch: 'full', redirectTo: 'app' },
  { path: '**', redirectTo: 'app' }
];
