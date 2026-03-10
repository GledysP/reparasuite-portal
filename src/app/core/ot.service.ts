import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

import { environment } from '../../environments/environment';
import {
  ApiListaResponse, ClienteOtItemDto, OtDetalleDto, FotoDto, PagoDto, CitaDto, MensajeDto
} from './models';

@Injectable({ providedIn: 'root' })
export class OtService {
  private base = environment.apiBaseUrl;

  constructor(private http: HttpClient) {}

  listarMisOts(clienteId: string, page = 0, size = 20) {
    const url = `${this.base}/api/v1/clientes/${clienteId}/ordenes-trabajo?page=${page}&size=${size}`;
    return firstValueFrom(this.http.get<ApiListaResponse<ClienteOtItemDto>>(url));
  }

  obtenerDetalle(idOrCodigo: string) {
    const url = `${this.base}/api/v1/ordenes-trabajo/${encodeURIComponent(idOrCodigo)}`;
    return firstValueFrom(this.http.get<OtDetalleDto>(url));
  }

  async anadirNota(otId: string, contenido: string) {
    const url = `${this.base}/api/v1/ordenes-trabajo/${otId}/notas`;
    await firstValueFrom(this.http.post(url, { contenido }, { responseType: 'text' as const }));
  }

  subirFotoOt(otId: string, file: File) {
    const url = `${this.base}/api/v1/ordenes-trabajo/${otId}/fotos`;
    const form = new FormData();
    form.append('file', file);
    return firstValueFrom(this.http.post<FotoDto>(url, form));
  }

  async aceptarPresupuesto(otId: string) {
    const url = `${this.base}/api/v1/ordenes-trabajo/${otId}/presupuesto/aceptar`;
    await firstValueFrom(this.http.post(url, { acepto: true }, { responseType: 'text' as const }));
  }

  async rechazarPresupuesto(otId: string) {
    const url = `${this.base}/api/v1/ordenes-trabajo/${otId}/presupuesto/rechazar`;
    await firstValueFrom(this.http.post(url, {}, { responseType: 'text' as const }));
  }

  async marcarTransferencia(otId: string) {
    const url = `${this.base}/api/v1/ordenes-trabajo/${otId}/pago/transferencia`;
    await firstValueFrom(this.http.post(url, {}, { responseType: 'text' as const }));
  }

  subirComprobantePago(otId: string, file: File) {
    const url = `${this.base}/api/v1/ordenes-trabajo/${otId}/pago/comprobante`;
    const form = new FormData();
    form.append('file', file);
    return firstValueFrom(this.http.post<PagoDto>(url, form));
  }

  reservarCita(otId: string, inicioIso: string, finIso: string) {
    const url = `${this.base}/api/v1/ordenes-trabajo/${otId}/citas`;
    return firstValueFrom(this.http.post<CitaDto>(url, { inicio: inicioIso, fin: finIso }));
  }

  reprogramarCita(citaId: string, inicioIso: string, finIso: string) {
    const url = `${this.base}/api/v1/ordenes-trabajo/citas/${citaId}`;
    return firstValueFrom(this.http.put<CitaDto>(url, { inicio: inicioIso, fin: finIso }));
  }

  enviarMensaje(otId: string, contenido: string) {
    const url = `${this.base}/api/v1/ordenes-trabajo/${otId}/mensajes`;
    return firstValueFrom(this.http.post<MensajeDto>(url, { contenido }));
  }
}
