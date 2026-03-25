import {
  Component,
  inject,
  HostBinding,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { FormBuilder, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';

import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCheckboxModule } from '@angular/material/checkbox';

import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatCheckboxModule,
  ],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
})
export class LoginComponent implements OnInit, OnDestroy {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);

  @HostBinding('class.rs-keyboard-open') keyboardOpen = false;

  loading = false;
  error = '';
  hidePassword = true;

  private baseViewportHeight =
    typeof window !== 'undefined'
      ? window.visualViewport?.height ?? window.innerHeight
      : 0;

  private readonly handleViewportResize = () => {
    if (typeof window === 'undefined') return;

    const currentHeight =
      window.visualViewport?.height ?? window.innerHeight;

    const delta = this.baseViewportHeight - currentHeight;

    // Umbral suficiente para distinguir teclado de cambios menores de UI
    this.keyboardOpen = delta > 140;
  };

  private readonly handleWindowResize = () => {
    if (typeof window === 'undefined') return;

    const currentHeight =
      window.visualViewport?.height ?? window.innerHeight;

    // Si el teclado no está abierto, actualizamos la referencia base
    if (!this.keyboardOpen) {
      this.baseViewportHeight = currentHeight;
    }

    this.handleViewportResize();
  };

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
    recordarme: [true],
  });

  ngOnInit() {
    if (typeof window === 'undefined') return;

    this.baseViewportHeight =
      window.visualViewport?.height ?? window.innerHeight;

    window.visualViewport?.addEventListener(
      'resize',
      this.handleViewportResize
    );
    window.addEventListener('resize', this.handleWindowResize);
  }

  ngOnDestroy() {
    if (typeof window === 'undefined') return;

    window.visualViewport?.removeEventListener(
      'resize',
      this.handleViewportResize
    );
    window.removeEventListener('resize', this.handleWindowResize);
  }

  togglePassword() {
    this.hidePassword = !this.hidePassword;
  }

  async onSubmit() {
    if (this.form.invalid || this.loading) return;

    this.error = '';
    this.loading = true;

    try {
      const { email, password, recordarme } = this.form.getRawValue();

      try {
        if (recordarme) localStorage.setItem('rs_remember_me', '1');
        else localStorage.removeItem('rs_remember_me');
      } catch {}

      await this.auth.login(email!, password!);
      this.router.navigateByUrl('/app');
    } catch (err: any) {
      this.error =
        err?.status === 429
          ? 'Demasiados intentos. Intenta más tarde.'
          : 'Credenciales inválidas o error de conexión';
      console.error('Login error:', err);
    } finally {
      this.loading = false;
    }
  }

  loginWithGoogle() {
    this.error = 'Inicio con Google disponible próximamente';
  }

  loginWithFacebook() {
    this.error = 'Inicio con Facebook disponible próximamente';
  }

  loginWithApple() {
    this.error = 'Inicio con Apple disponible próximamente';
  }
}