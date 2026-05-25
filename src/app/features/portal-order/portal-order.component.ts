import {
  AfterViewChecked, Component, ElementRef, HostListener, OnDestroy, OnInit,
  ViewChild, computed, inject, signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';

import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatToolbarModule } from '@angular/material/toolbar';

import { AuthService } from '../../core/auth.service';
import { decodeJwt } from '../../core/jwt';
import { CitaDto, ClienteOtItemDto, MensajeDto, OtDetalleDto, TicketDetalleDto, TicketListaItemDto } from '../../core/models';
import { OtService } from '../../core/ot.service';
import { TicketsService } from '../../core/tickets.service';
import { TicketDialogComponent } from '../portal/ticket-dialog/ticket-dialog.component';

// --- Tipos de Datos ---
type StepKey = 'RECIBIDA' | 'PRESUPUESTO' | 'APROBADA' | 'EN_CURSO' | 'FINALIZADA';
type PortalView = 'home' | 'success' | 'order';
type OrderSection = 'presupuesto' | 'cita' | 'pago' | 'chat';
type LoadOpts = { silent?: boolean; quiet?: boolean; preserveSelection?: boolean; autoLoadDetalle?: boolean; forceScroll?: boolean; animate?: boolean; };
type ChatRenderItem = { id: string | number; message: MensajeDto; isMine: boolean; showMeta: boolean; showDayDivider: boolean; dayLabel: string; };

@Component({
  selector: 'app-portal-order',
  standalone: true,
  imports: [
    CommonModule, ReactiveFormsModule, MatToolbarModule, MatButtonModule,
    MatIconModule, MatProgressBarModule, MatSnackBarModule, MatDialogModule,
    MatCheckboxModule, MatMenuModule, MatBadgeModule
  ],
  templateUrl: './portal-order.component.html',
  styleUrls: ['./portal-order.component.scss'],
})
export class PortalOrderComponent implements OnInit, OnDestroy, AfterViewChecked {
  // Referencias al DOM
  @ViewChild('orderTopRef') private orderTopRef?: ElementRef<HTMLElement>;
  @ViewChild('budgetSectionRef') private budgetSectionRef?: ElementRef<HTMLElement>;
  @ViewChild('citaSectionRef') private citaSectionRef?: ElementRef<HTMLElement>;
  @ViewChild('paymentSectionRef') private paymentSectionRef?: ElementRef<HTMLElement>;
  @ViewChild('chatSectionRef') private chatSectionRef?: ElementRef<HTMLElement>;
  @ViewChild('chatScroll') private chatContainer?: ElementRef<HTMLDivElement>;
  @ViewChild('chatInput') private chatInput?: ElementRef<HTMLInputElement>;

  // Servicios
  private readonly fb = inject(FormBuilder);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly otService = inject(OtService);
  private readonly dialog = inject(MatDialog);

  // Estados
  readonly loading = signal(false);
  readonly actionBusy = signal(false);
  readonly activeOrderSection = signal<OrderSection>('presupuesto');

  readonly ots = signal<ClienteOtItemDto[]>([]);
  readonly selectedOtDetalle = signal<OtDetalleDto | null>(null);
  readonly selectedOtCodigoSignal = signal<string | null>(null);
  
  // Caché de nombres
  readonly otNameCache = signal<Record<string, string>>({});

  readonly aceptoCheck = signal(false);
  readonly pagoFile = signal<File | null>(null);
  readonly detailFade = signal(false);
  readonly msgForm = this.fb.group({ contenido: [''] });

  readonly steps: ReadonlyArray<{ key: StepKey; label: string; icon: string }> = [
    { key: 'RECIBIDA', label: 'Recibida', icon: 'inventory_2' },
    { key: 'PRESUPUESTO', label: 'Presupuesto', icon: 'request_quote' },
    { key: 'APROBADA', label: 'Aprobada', icon: 'verified' },
    { key: 'EN_CURSO', label: 'En proceso', icon: 'build' },
    { key: 'FINALIZADA', label: 'Finalizada', icon: 'task_alt' },
  ];

  // Señales Computadas
  readonly selectedOtListItem = computed<ClienteOtItemDto | null>(() => {
    const codigo = this.selectedOtCodigoSignal();
    return codigo ? (this.ots().find((item) => item.codigo === codigo) ?? null) : null;
  });

  readonly activeServiceTitle = computed(() => this.getOtDisplayName(this.selectedOtListItem(), this.selectedOtDetalle()));
  
  // AQUÍ ESTÁ EL LLAMADO A LA FUNCIÓN DE BADGES
  readonly activeServiceBadges = computed(() => this.buildServiceBadges(this.selectedOtDetalle()));

  readonly stepKey = computed<StepKey>(() => this.resolveBusinessStep(this.selectedOtDetalle(), this.selectedOtListItem()));
  readonly stepIndex = computed(() => this.stepRank[this.stepKey()]);

  readonly nextCita = computed<CitaDto | null>(() => {
    const citas = [...(this.selectedOtDetalle()?.citas ?? [])].filter(i => i.estado !== 'CANCELADA').sort((a, b) => this.toMillis(a.inicio) - this.toMillis(b.inicio));
    return citas.length > 0 ? citas[0] : null;
  });

  readonly quickUnreadCount = computed(() => (this.selectedOtDetalle()?.mensajes ?? []).filter(m => !this.isClienteMsg(m)).length);

  readonly chatItems = computed<ChatRenderItem[]>(() => {
    const messages = [...(this.selectedOtDetalle()?.mensajes ?? [])].sort((a, b) => this.toMillis(a.createdAt) - this.toMillis(b.createdAt));
    return messages.map((message, index) => {
      const prev = messages[index - 1];
      const isMine = this.isClienteMsg(message);
      const sameSenderAsPrev = !!prev && this.normalizeStatus(prev.remitenteTipo) === this.normalizeStatus(message.remitenteTipo);
      const sameDayAsPrev = !!prev && this.sameLocalDay(prev.createdAt, message.createdAt);
      return { id: message.id || index, message, isMine, showMeta: !isMine && (!sameSenderAsPrev || !sameDayAsPrev), showDayDivider: !prev || !sameDayAsPrev, dayLabel: this.getChatDayLabel(message.createdAt) };
    });
  });

  private readonly stepRank: Record<StepKey, number> = { RECIBIDA: 0, PRESUPUESTO: 1, APROBADA: 2, EN_CURSO: 3, FINALIZADA: 4 };
  private detailPollHandle: ReturnType<typeof setInterval> | null = null;
  private detailInFlight = false;
  private scrollRequested = false;
  private scrollForce = false;

  ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      const codigo = params.get('codigo');
      if (codigo) this.selectedOtCodigoSignal.set(codigo);
    });
    void this.refreshAll();
    this.detailPollHandle = setInterval(() => { void this.pollDetailTick(); }, 10000);
  }

  ngOnDestroy(): void { 
    if (this.detailPollHandle) clearInterval(this.detailPollHandle); 
  }

  ngAfterViewChecked(): void {
    if (this.scrollRequested && (this.scrollForce || this.isChatNearBottom(90))) {
      this.scrollToBottom();
      this.scrollRequested = false;
      this.scrollForce = false;
    }
  }

  trackById(index: number, item: any): string { return item.id || item.codigo || index.toString(); }
  sendReady(): boolean { return (this.msgForm.value.contenido ?? '').trim().length > 0; }

  // --- Navegación ---
  goHome(): void { this.router.navigate(['/portal']); }
  goToBudget(): void { window.scrollTo({ top: 0, behavior: 'smooth' }); this.activeOrderSection.set('presupuesto'); }
  goToChat(): void { this.activeOrderSection.set('chat'); setTimeout(() => this.chatInput?.nativeElement?.focus(), 220); }

  openNewTicket(): void {
    const ref = this.dialog.open(TicketDialogComponent, { 
      data: { mode: 'new' }, width: '92vw', maxWidth: '440px', height: 'auto', maxHeight: '85dvh', 
      panelClass: 'rs-ticket-dialog-panel', backdropClass: 'rs-backdrop' 
    });
    ref.afterClosed().subscribe(ticket => { if (ticket) this.router.navigate(['/portal/exito']); });
  }

  async selectOtChip(codigo: string): Promise<void> {
    if (!codigo) return;
    this.selectedOtCodigoSignal.set(codigo);
    await this.loadDetalle(codigo, { forceScroll: false, animate: true });
  }

  onPagoFileSelected(event: Event): void { this.pagoFile.set((event.target as HTMLInputElement).files?.[0] ?? null); }

  // --- Acciones HTTP ---
  async aceptar(otId: string): Promise<void> {
    if (!this.aceptoCheck()) return;
    this.actionBusy.set(true);
    try { await this.otService.aceptarPresupuesto(otId); await this.loadDetalle(otId); this.snackBar.open('Aceptado', undefined, { duration: 1400 }); } 
    catch { this.snackBar.open('Error al aceptar', 'Cerrar', { duration: 2500 }); } finally { this.actionBusy.set(false); }
  }

  async rechazar(otId: string): Promise<void> {
    this.actionBusy.set(true);
    try { await this.otService.rechazarPresupuesto(otId); await this.loadDetalle(otId); this.snackBar.open('Rechazado', undefined, { duration: 1400 }); } 
    catch { this.snackBar.open('Error al rechazar', 'Cerrar', { duration: 2500 }); } finally { this.actionBusy.set(false); }
  }

  async uploadComprobante(otId: string): Promise<void> {
    if (!this.pagoFile()) return;
    this.actionBusy.set(true);
    try { await this.otService.subirComprobantePago(otId, this.pagoFile()!); this.pagoFile.set(null); await this.loadDetalle(otId); this.snackBar.open('Enviado', undefined, { duration: 1400 }); } 
    catch { this.snackBar.open('Error al subir', 'Cerrar', { duration: 2500 }); } finally { this.actionBusy.set(false); }
  }

  async sendMessage(): Promise<void> {
    const ot = this.selectedOtDetalle();
    if (!ot) return;
    this.actionBusy.set(true);
    try { await this.otService.enviarMensaje(ot.codigo, (this.msgForm.value.contenido ?? '').trim()); this.msgForm.reset({ contenido: '' }); await this.loadDetalle(ot.codigo, { forceScroll: true }); } 
    catch { this.snackBar.open('Error', 'Cerrar'); } finally { this.actionBusy.set(false); }
  }

  // --- Funciones para la Vista (Chips, Labels y Badges) ---
  
  presupuestoEstadoLabel(val?: string | null): string { const l: any = { BORRADOR: 'Borrador', ENVIADO: 'Pendiente', ACEPTADO: 'Aceptado', RECHAZADO: 'Rechazado' }; return l[this.normalizeStatus(val)] ?? 'Pendiente'; }
  citaEstadoLabel(val?: string | null): string { return val || 'Sin estado'; }
  pagoEstadoLabel(val?: string | null): string { const l: any = { PENDIENTE: 'Pendiente', MARCADO_TRANSFERENCIA: 'En revisión', COMPROBANTE_SUBIDO: 'En revisión', CONFIRMADO: 'Confirmado' }; return l[this.normalizeStatus(val)] ?? 'Pendiente'; }
  serviceStatusLabel(ot: OtDetalleDto | null): string { const s = this.normalizeStatus(ot?.estado); const l: any = { RECIBIDA: 'Solicitud recibida', PRESUPUESTO: 'Presupuesto listo', APROBADA: 'Orden aprobada', EN_CURSO: 'En proceso', FINALIZADA: 'Servicio finalizado' }; return l[s] ?? 'Estado'; }
  
  getOtDisplayName(ot: any, detail: any): string { return (detail?.equipo ?? '').trim() || detail?.codigo || ot?.codigo || 'Equipo'; }
  
  // Chip Label que lee el equipo de Java (o la caché)
  getOtChipLabel(item: ClienteOtItemDto): string { 
    return item.equipo || this.otNameCache()[item.codigo] || item.codigo;
  }
  
  // Icono universal para evitar condicionales pesados y asegurar escalabilidad
  getOtChipIcon(item: ClienteOtItemDto): string { 
    return 'devices'; 
  }

  // AQUÍ ESTÁ LA FUNCIÓN FALTANTE QUE CREA LOS BADGES CON SUS COLORES
  buildServiceBadges(ot: OtDetalleDto | null): { label: string, cssClass: string, icon?: string }[] {
    if (!ot) return [];
    const badges: { label: string, cssClass: string, icon?: string }[] = [];

    // 1. PRIORIDAD (Semáforo)
    if (ot.prioridad) {
      const p = this.normalizeStatus(ot.prioridad); // ALTA, MEDIA, BAJA
      let cssClass = 'badge-gray';
      let icon = '';
      
      if (p === 'ALTA' || p === 'URGENTE') { cssClass = 'badge-red'; icon = 'error_outline'; }
      else if (p === 'MEDIA') { cssClass = 'badge-orange'; icon = 'warning_amber'; }
      else if (p === 'BAJA') { cssClass = 'badge-green'; icon = 'check_circle_outline'; }

      badges.push({ label: `Prioridad ${this.formatLabel(ot.prioridad)}`, cssClass, icon });
    }

    // 2. MODALIDAD (Domicilio vs Tienda)
    if (ot.tipo) {
      const t = this.normalizeStatus(ot.tipo);
      const cssClass = t === 'DOMICILIO' ? 'badge-purple' : 'badge-blue';
      const icon = t === 'DOMICILIO' ? 'local_shipping' : 'storefront';
      badges.push({ label: this.formatLabel(ot.tipo), cssClass, icon });
    }

    // 3. SERVICIOS (Reparación, Mantenimiento)
    if (ot.categoriasTrabajo) {
      ot.categoriasTrabajo.forEach(c => {
        badges.push({ label: this.formatLabel(c), cssClass: 'badge-gray', icon: 'build' });
      });
    }

    return badges;
  }
  
  getCurrentOtActionId(ot: OtDetalleDto): string { return ot.codigo; }
  getSenderName(message: MensajeDto): string { return (message.remitenteNombre || '').trim() || 'Técnico'; }
  isClienteMsg(message: MensajeDto): boolean { return this.normalizeStatus(message.remitenteTipo) === 'CLIENTE'; }

  // --- Lógica de Carga y Refresco ---
  async refreshAll(): Promise<void> { await Promise.all([this.loadOts({ autoLoadDetalle: true })]); }

  private async loadOts(opts: LoadOpts = {}): Promise<void> {
    try {
      const response = await this.otService.listarMisOts(0, 50);
      this.ots.set(response.items);
      const wanted = this.selectedOtCodigoSignal();
      const nextCodigo = wanted && response.items.some(i => i.codigo === wanted) ? wanted : response.items[0]?.codigo ?? null;
      this.selectedOtCodigoSignal.set(nextCodigo);
      if (opts.autoLoadDetalle && nextCodigo) await this.loadDetalle(nextCodigo, { silent: true });
    } catch { console.error('Error ots'); }
  }

  private async loadDetalle(codigo: string, opts: LoadOpts = {}): Promise<void> {
    if (!opts.silent) this.loading.set(true);
    try {
      const detail = await this.otService.obtenerDetalle(codigo);
      this.selectedOtDetalle.set(detail);
      this.selectedOtCodigoSignal.set(detail.codigo);
      this.aceptoCheck.set(false);
      
      // Guardamos el nombre en caché para que los chips nunca queden en blanco si Java no los manda
      if (detail.equipo) {
        this.otNameCache.update(curr => ({...curr, [codigo]: detail.equipo!}));
      }

      if (opts.animate) this.triggerFadeIn();
      if (opts.forceScroll) this.requestScroll(true);
    } catch { console.error('Error detalle'); } finally { if (!opts.silent) this.loading.set(false); }
  }

  private async pollDetailTick(): Promise<void> {
    if (this.detailInFlight || this.loading() || this.actionBusy() || !this.selectedOtCodigoSignal()) return;
    this.detailInFlight = true;
    try { await this.loadDetalle(this.selectedOtCodigoSignal()!, { silent: true }); } finally { this.detailInFlight = false; }
  }

  // --- Utilidades ---
  private formatLabel(value?: string | null): string { const n = (value ?? '').trim().replace(/_/g, ' ').toLowerCase(); return n ? n.charAt(0).toUpperCase() + n.slice(1) : ''; }
  private normalizeStatus(value?: string | null): string { return (value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase().replace(/[\s-]+/g, '_'); }
  private toMillis(value?: string | null): number { const n = value ? new Date(value).getTime() : 0; return Number.isFinite(n) ? n : 0; }
  private sameLocalDay(a?: string | null, b?: string | null): boolean { if (!a || !b) return false; return new Date(a).toDateString() === new Date(b).toDateString(); }
  private getChatDayLabel(value?: string | null): string { return new Date(value!).toLocaleDateString(); }
  private stepFromRawStatus(statusRaw?: string | null): StepKey { const s = this.normalizeStatus(statusRaw); if (s === 'FINALIZADA' || s === 'CERRADA') return 'FINALIZADA'; if (['RECIBIDA', 'PRESUPUESTO', 'APROBADA', 'EN_CURSO'].includes(s)) return s as StepKey; return 'RECIBIDA'; }
  private resolveBusinessStep(ot: OtDetalleDto | null, listItem: ClienteOtItemDto | null): StepKey { if (!ot && !listItem) return 'RECIBIDA'; const dk = this.stepFromRawStatus(ot?.estado); if (ot?.presupuesto?.estado === 'ENVIADO') return 'PRESUPUESTO'; if (ot?.presupuesto?.estado === 'ACEPTADO' && this.stepRank[dk] < this.stepRank.APROBADA) return 'APROBADA'; return dk; }
  private scrollIntoView(ref: ElementRef<HTMLElement> | undefined, section: OrderSection): void { this.activeOrderSection.set(section); if (ref?.nativeElement) window.scrollTo({ top: ref.nativeElement.getBoundingClientRect().top + window.scrollY - 84, behavior: 'smooth' }); }
  private requestScroll(force = false): void { this.scrollRequested = true; this.scrollForce = force; }
  private isChatNearBottom(thresholdPx = 80): boolean { try { const el = this.chatContainer?.nativeElement; return !el || (el.scrollHeight - el.scrollTop - el.clientHeight < thresholdPx); } catch { return true; } }
  private scrollToBottom(): void { try { const el = this.chatContainer?.nativeElement; if (el) el.scrollTop = el.scrollHeight; } catch {} }
  private triggerFadeIn(): void { this.detailFade.set(false); setTimeout(() => { this.detailFade.set(true); setTimeout(() => this.detailFade.set(false), 220); }); }
}