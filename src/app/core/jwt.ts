export interface JwtPayload {
  sub?: string;
  exp?: number;
  rol?: string;
  email?: string;
  usuario?: string;
}

export function decodeJwt(token: string): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) return {};
  const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');

  const json = decodeURIComponent(
    atob(payload)
      .split('')
      .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
      .join('')
  );

  try {
    return JSON.parse(json) as JwtPayload;
  } catch {
    return {};
  }
}

export function isExpired(token: string): boolean {
  const p = decodeJwt(token);
  if (!p.exp) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  return p.exp <= nowSec;
}
