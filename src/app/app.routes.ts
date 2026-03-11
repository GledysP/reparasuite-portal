import { Routes } from '@angular/router';
import { LoginComponent } from './features/login/login.component';
import { RegisterComponent } from './features/register/register.component';
import { PortalComponent } from './features/portal/portal.component';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'auth/register', component: RegisterComponent },
  { path: 'register', redirectTo: 'auth/register', pathMatch: 'full' },
  { path: 'app', component: PortalComponent, canActivate: [authGuard] },
  { path: '', pathMatch: 'full', redirectTo: 'app' },
  { path: '**', redirectTo: 'app' }
];