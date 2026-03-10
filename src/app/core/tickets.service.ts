import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../environments/environment';
import {
  ApiListaResponse,
  TicketDetalleDto,
  TicketListaItemDto,
  TicketFotoDto
} from './models';

export type TicketCrearPayload = {
  asunto: string;
  descripcion: string; // compat legacy
  equipo?: string | null;
  descripcionFalla?: string | null;
  tipoServicioSugerido?: 'TIENDA' | 'DOMICILIO' | '' | null;
  direccion?: string | null;
};

@Injectable({ providedIn: 'root' })
export class TicketsService {
  private base = environment.apiBaseUrl;

  constructor(private http: HttpClient) {}

  listar(page = 0, size = 20) {
    const url = `${this.base}/api/v1/tickets?page=${page}&size=${size}`;
    return firstValueFrom(this.http.get<ApiListaResponse<TicketListaItemDto>>(url));
  }

  obtener(id: string) {
    const url = `${this.base}/api/v1/tickets/${id}`;
    return firstValueFrom(this.http.get<TicketDetalleDto>(url));
  }

  // ✅ acepta string/string legacy o payload nuevo
  crear(asunto: string, descripcion: string): Promise<TicketDetalleDto>;
  crear(payload: TicketCrearPayload): Promise<TicketDetalleDto>;
  crear(arg1: string | TicketCrearPayload, descripcion?: string): Promise<TicketDetalleDto> {
    const url = `${this.base}/api/v1/tickets`;

    const body: TicketCrearPayload =
      typeof arg1 === 'string'
        ? { asunto: arg1, descripcion: descripcion ?? '' }
        : arg1;

    return firstValueFrom(this.http.post<TicketDetalleDto>(url, body));
  }

  anadirMensaje(id: string, contenido: string) {
    const url = `${this.base}/api/v1/tickets/${id}/mensajes`;
    return firstValueFrom(this.http.post(url, { contenido }, { responseType: 'text' as const }));
  }

  // ✅ subida de foto de ticket (portal cliente)
  subirFoto(ticketId: string, file: File) {
    const url = `${this.base}/api/v1/tickets/${ticketId}/fotos`;
    const form = new FormData();
    form.append('file', file);
    return firstValueFrom(this.http.post<TicketFotoDto>(url, form));
  }
}