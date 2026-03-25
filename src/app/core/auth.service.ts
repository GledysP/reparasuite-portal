import { Injectable, computed, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../environments/environment';
import { decodeJwt, isExpired } from './jwt';

interface PortalLoginRequest {
  email: string;
  password: string;
}

interface PortalLoginResponse {
  accessToken: string;
  refreshToken: string | null;
  expiresInSeconds: number;
}

interface PortalRegisterRequest {
  nombre: string;
  email: string;
  password: string;
  telefono: string;
}

interface PortalRegisterResponse {
  message: string;
}

const TOKEN_KEY = 'reparasuite_portal_token';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private tokenSig = signal<string | null>(null);

  token = computed(() => this.tokenSig());
  isLoggedIn = computed(() => {
    const t = this.tokenSig();
    return !!t && !isExpired(t);
  });

  constructor(private http: HttpClient) {
    const t = localStorage.getItem(TOKEN_KEY);
    if (t && !isExpired(t)) this.tokenSig.set(t);
  }

  async login(email: string, password: string): Promise<void> {
    const url = `${environment.apiBaseUrl}/api/v1/portal/auth/login`;

    const res = await firstValueFrom(
      this.http.post<PortalLoginResponse>(
        url,
        { email, password } as PortalLoginRequest,
        { withCredentials: true }
      )
    );

    localStorage.setItem(TOKEN_KEY, res.accessToken);
    this.tokenSig.set(res.accessToken);
  }

  async refresh(): Promise<boolean> {
    try {
      const url = `${environment.apiBaseUrl}/api/v1/portal/auth/refresh`;

      const res = await firstValueFrom(
        this.http.post<PortalLoginResponse>(url, {}, { withCredentials: true })
      );

      localStorage.setItem(TOKEN_KEY, res.accessToken);
      this.tokenSig.set(res.accessToken);
      return true;
    } catch {
      this.logoutLocal();
      return false;
    }
  }

  async register(nombre: string, email: string, password: string, telefono: string): Promise<string> {
    const url = `${environment.apiBaseUrl}/api/v1/portal/auth/register`;

    const res = await firstValueFrom(
      this.http.post<PortalRegisterResponse>(
        url,
        { nombre, email, password, telefono } as PortalRegisterRequest
      )
    );

    return res.message || 'Cuenta creada correctamente';
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post<void>(
          `${environment.apiBaseUrl}/api/v1/portal/auth/logout`,
          {},
          { withCredentials: true }
        )
      );
    } finally {
      this.logoutLocal();
    }
  }

  logoutLocal(): void {
    localStorage.removeItem(TOKEN_KEY);
    this.tokenSig.set(null);
  }

  ensureValidOrLogout(): void {
    const t = this.tokenSig();
    if (!t) return;
    if (isExpired(t)) this.logoutLocal();
  }

  getClienteId(): string | null {
    const t = this.tokenSig();
    if (!t) return null;
    return decodeJwt(t).sub ?? null;
  }
}