import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { from, switchMap, catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);

  auth.ensureValidOrLogout();

  const token = auth.token();

  const isAuthEndpoint =
    req.url.includes('/portal/auth/login') ||
    req.url.includes('/portal/auth/refresh') ||
    req.url.includes('/portal/auth/logout') ||
    req.url.includes('/portal/auth/register');

  let authReq = req.clone({
    withCredentials: true,
  });

  if (!isAuthEndpoint && token) {
    authReq = authReq.clone({
      setHeaders: {
        Authorization: `Bearer ${token}`,
      },
    });
  }

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status !== 401 || isAuthEndpoint) {
        return throwError(() => error);
      }

      return from(auth.refresh()).pipe(
        switchMap((ok) => {
          if (!ok) {
            auth.logoutLocal();
            return throwError(() => error);
          }

          const newToken = auth.token();

          const retryReq = req.clone({
            withCredentials: true,
            setHeaders: newToken
              ? { Authorization: `Bearer ${newToken}` }
              : {},
          });

          return next(retryReq);
        }),
        catchError((refreshError) => {
          auth.logoutLocal();
          return throwError(() => refreshError);
        })
      );
    })
  );
};