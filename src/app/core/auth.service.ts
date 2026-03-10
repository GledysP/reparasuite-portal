import { Injectable, computed, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../environments/environment';
import { decodeJwt, isExpired } from './jwt';

interface PortalLoginRequest { email: string; password: string; }
interface PortalLoginResponse { token: string; }

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
      this.http.post<PortalLoginResponse>(url, { email, password } as PortalLoginRequest)
    );
    localStorage.setItem(TOKEN_KEY, res.token);
    this.tokenSig.set(res.token);
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    this.tokenSig.set(null);
  }

  ensureValidOrLogout(): void {
    const t = this.tokenSig();
    if (!t) return;
    if (isExpired(t)) this.logout();
  }

  getClienteId(): string | null {
    const t = this.tokenSig();
    if (!t) return null;
    return decodeJwt(t).sub ?? null;
  }
}
