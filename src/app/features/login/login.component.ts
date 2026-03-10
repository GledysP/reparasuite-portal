import { Component, inject } from '@angular/core';
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
export class LoginComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);

  loading = false;
  error = '';
  hidePassword = true;

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
    recordarme: [true],
  });

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
    } catch (err) {
      this.error = 'Credenciales inválidas o error de conexión';
      console.error('Login error:', err);
    } finally {
      this.loading = false;
    }
  }

  loginWithGoogle() {
    console.log('Google login');
  }

  loginWithFacebook() {
    console.log('Facebook login');
  }

  loginWithApple() {
    console.log('Apple login');
  }
}