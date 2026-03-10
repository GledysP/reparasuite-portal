export interface ApiListaResponse<T> {
  items: T[];
  total: number;
}

export interface ClienteOtItemDto {
  id?: string; // opcional por compat
  codigo: string;
  estado: string;
  tipo: string;
  updatedAt: string;
}

export interface HistorialItemDto {
  fecha: string;
  evento: string;
  descripcion: string;
  usuario: { nombre: string };
}

export interface NotaDto {
  id: string;
  contenido: string;
  createdAt: string;
}

export interface FotoDto {
  id: string;
  url: string;
  createdAt: string;
}

export interface PresupuestoDto {
  id: string;
  estado: string;
  importe: number;
  detalle: string;
  aceptacionCheck: boolean;
  sentAt?: string | null;
  respondedAt?: string | null;
}

export interface PagoDto {
  id: string;
  estado: string;
  importe: number;
  comprobanteUrl?: string | null;
}

export interface CitaDto {
  id: string;
  inicio: string;
  fin: string;
  estado: string;
}

export interface MensajeDto {
  id: string;
  remitenteTipo: string;
  remitenteNombre: string;
  contenido: string;
  createdAt: string;
}

export interface ClienteResumenDto {
  id: string;
  nombre: string;
  telefono?: string | null;
  email?: string | null;
}

export interface OtDetalleDto {
  id: string;
  codigo: string;
  estado: string;
  tipo: string;
  prioridad: string;
  descripcion: string;

  cliente: ClienteResumenDto;
  tecnico: any | null;

  fechaPrevista?: string | null;
  direccion?: string | null;
  notasAcceso?: string | null;

  notas: NotaDto[];
  fotos: FotoDto[];
  historial: HistorialItemDto[];

  presupuesto?: PresupuestoDto | null;
  pago?: PagoDto | null;
  citas: CitaDto[];
  mensajes: MensajeDto[];

  createdAt: string;
  updatedAt: string;
}

export interface TicketListaItemDto {
  id: string;
  estado: string;
  asunto: string;
  updatedAt: string;
}

export interface TicketFotoDto {
  id: string;
  url: string;
  nombreOriginal?: string | null;
  createdAt: string;
}

// ✅ Alineado con tu backend actual (TicketDetalleDto Java)
export interface TicketDetalleDto {
  id: string;
  estado: string;
  asunto: string;
  descripcion: string;
  mensajes: MensajeDto[];
  createdAt: string;
  updatedAt: string;

  // vínculo a OT (si ya existe)
  ordenTrabajoId?: string | null;

  // snapshots cliente
  clienteNombre?: string | null;
  clienteTelefono?: string | null;
  clienteEmail?: string | null;

  // campos estructurados
  equipo?: string | null;
  descripcionFalla?: string | null;
  tipoServicioSugerido?: string | null;
  direccion?: string | null;

  // fotos ticket
  fotos?: TicketFotoDto[];
}