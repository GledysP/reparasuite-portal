import {
  AfterViewChecked,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';

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
import {
  CitaDto,
  ClienteOtItemDto,
  MensajeDto,
  OtDetalleDto,
  TicketDetalleDto,
  TicketListaItemDto,
} from '../../core/models';
import { OtService } from '../../core/ot.service';
import { TicketsService } from '../../core/tickets.service';
import { TicketDialogComponent } from './ticket-dialog/ticket-dialog.component';

type StepKey = 'RECIBIDA' | 'PRESUPUESTO' | 'APROBADA' | 'EN_CURSO' | 'FINALIZADA';
type PortalView = 'home' | 'success' | 'order';
type OrderSection = 'presupuesto' | 'cita' | 'pago' | 'chat';

type LoadOpts = {
  silent?: boolean;
  quiet?: boolean;
  preserveSelection?: boolean;
  autoLoadDetalle?: boolean;
  forceScroll?: boolean;
  animate?: boolean;
};

type ProcessNotificationKind =
  | 'pending-ticket'
  | 'presupuesto'
  | 'cita'
  | 'pago'
  | 'chat'
  | 'estado';

type ProcessNotificationItem = {
  kind: ProcessNotificationKind;
  icon: string;
  title: string;
  subtitle: string;
  date?: string | null;
};

type ChatRenderItem = {
  id: string | number;
  message: MensajeDto;
  isMine: boolean;
  showMeta: boolean;
  showDayDivider: boolean;
  dayLabel: string;
};

@Component({
  selector: 'app-portal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatSnackBarModule,
    MatDialogModule,
    MatCheckboxModule,
    MatMenuModule,
    MatBadgeModule,
  ],
  templateUrl: './portal.component.html',
  styleUrls: ['./portal.component.scss'],
})
export class PortalComponent implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('orderTopRef') private orderTopRef?: ElementRef<HTMLElement>;
  @ViewChild('budgetSectionRef') private budgetSectionRef?: ElementRef<HTMLElement>;
  @ViewChild('citaSectionRef') private citaSectionRef?: ElementRef<HTMLElement>;
  @ViewChild('paymentSectionRef') private paymentSectionRef?: ElementRef<HTMLElement>;
  @ViewChild('chatSectionRef') private chatSectionRef?: ElementRef<HTMLElement>;
  @ViewChild('chatScroll') private chatContainer?: ElementRef<HTMLDivElement>;
  @ViewChild('chatInput') private chatInput?: ElementRef<HTMLInputElement>;

  private readonly fb = inject(FormBuilder);
  private readonly snackBar = inject(MatSnackBar);

  readonly loading = signal(false);
  readonly actionBusy = signal(false);

  readonly portalView = signal<PortalView>('home');
  readonly activeOrderSection = signal<OrderSection>('presupuesto');
  readonly lastOrderSection = signal<OrderSection>('presupuesto');
  readonly userDisplayName = signal('Cliente');

  readonly ots = signal<ClienteOtItemDto[]>([]);
  readonly tickets = signal<TicketListaItemDto[]>([]);
  readonly selectedOtDetalle = signal<OtDetalleDto | null>(null);
  readonly selectedOtCodigoSignal = signal<string | null>(null);

  readonly aceptoCheck = signal(false);
  readonly pagoFile = signal<File | null>(null);
  readonly detailFade = signal(false);

  readonly pendingTicket = signal<TicketDetalleDto | null>(null);
  readonly submittedTicket = signal<TicketDetalleDto | null>(null);

  readonly msgForm = this.fb.group({
    contenido: [''],
  });

  readonly welcomeHighlights = [
    {
      id: 'step-1',
      icon: 'edit_square',
      title: 'Envía tu solicitud',
      desc: 'Crea el ticket en segundos describiendo el fallo de tu equipo.',
    },
    {
      id: 'step-2',
      icon: 'verified',
      title: 'El taller la valida',
      desc: 'Aceptamos la solicitud y generamos tu orden de servicio oficial.',
    },
    {
      id: 'step-3',
      icon: 'monitor_heart',
      title: 'Sigue todo en tiempo real',
      desc: 'Accede a presupuestos, citas, pagos y chat con técnicos especializados.',
    },
  ] as const;

  readonly steps: ReadonlyArray<{ key: StepKey; label: string; icon: string }> = [
    { key: 'RECIBIDA', label: 'Recibida', icon: 'inventory_2' },
    { key: 'PRESUPUESTO', label: 'Presupuesto', icon: 'request_quote' },
    { key: 'APROBADA', label: 'Aprobada', icon: 'verified' },
    { key: 'EN_CURSO', label: 'En proceso', icon: 'build' },
    { key: 'FINALIZADA', label: 'Finalizada', icon: 'task_alt' },
  ];

  readonly paymentReferenceLabel = 'Datos de transferencia';
  readonly paymentReferenceValue = '04249264883 · 24964090 · 0102';

  readonly selectedOtListItem = computed<ClienteOtItemDto | null>(() => {
    const codigo = this.selectedOtCodigoSignal();
    if (!codigo) return null;
    return this.ots().find((item) => item.codigo === codigo) ?? null;
  });

  readonly firstName = computed(() => {
    const raw = (this.userDisplayName() || 'Cliente').trim();
    return raw.split(/\s+/)[0] || 'Cliente';
  });

  readonly welcomeWord = computed(() => this.inferWelcomeWord(this.firstName()));
  readonly homeWelcomeTitle = computed(() => `${this.welcomeWord()}, ${this.firstName()}`);
  readonly profileInitial = computed(() => this.firstName().charAt(0).toUpperCase() || 'C');

  readonly activeServiceTitle = computed(() => {
    return this.getOtDisplayName(this.selectedOtListItem(), this.selectedOtDetalle());
  });

  readonly activeServiceBadges = computed(() => {
    return this.buildServiceBadges(this.selectedOtDetalle());
  });

  readonly stepKey = computed<StepKey>(() =>
    this.resolveBusinessStep(this.selectedOtDetalle(), this.selectedOtListItem())
  );

  readonly stepIndex = computed(() => this.stepRank[this.stepKey()]);

  readonly nextCita = computed<CitaDto | null>(() => {
    const citas = [...(this.selectedOtDetalle()?.citas ?? [])];
    if (!citas.length) return null;

    const visible = citas
      .filter((item) => item.estado !== 'CANCELADA')
      .sort((a, b) => this.toMillis(a.inicio) - this.toMillis(b.inicio));

    if (visible.length > 0) return visible[0];

    return citas.sort((a, b) => this.toMillis(a.inicio) - this.toMillis(b.inicio))[0] ?? null;
  });

  readonly quickUnreadCount = computed(() => {
    const messages = this.selectedOtDetalle()?.mensajes ?? [];
    return messages.filter((message) => !this.isClienteMsg(message)).length;
  });

  readonly processNotifications = computed<ProcessNotificationItem[]>(() => {
    const items: ProcessNotificationItem[] = [];
    const ot = this.selectedOtDetalle();

    if (this.pendingTicket()) {
      items.push({
        kind: 'pending-ticket',
        icon: 'schedule',
        title: 'Solicitud recibida',
        subtitle: 'Tu solicitud fue registrada y está en validación.',
      });
    }

    if (!ot) return items;

    if (ot.presupuesto?.estado === 'ENVIADO') {
      items.push({
        kind: 'presupuesto',
        icon: 'request_quote',
        title: 'Presupuesto disponible',
        subtitle: 'Ya puedes revisar el presupuesto de tu equipo.',
      });
    }

    if (this.nextCita()) {
      items.push({
        kind: 'cita',
        icon: 'event',
        title: 'Cita programada',
        subtitle: 'Ya tienes una fecha confirmada por el taller.',
        date: this.nextCita()?.inicio ?? null,
      });
    }

    if (this.quickUnreadCount() > 0) {
      items.push({
        kind: 'chat',
        icon: 'chat_bubble_outline',
        title: 'Mensaje nuevo',
        subtitle: 'Tu técnico dejó una actualización.',
      });
    }

    if (ot.pago?.estado === 'COMPROBANTE_SUBIDO') {
      items.push({
        kind: 'pago',
        icon: 'payments',
        title: 'Comprobante enviado',
        subtitle: 'El taller podrá revisar tu pago.',
      });
    }

    if (this.stepKey() === 'FINALIZADA') {
      items.push({
        kind: 'estado',
        icon: 'task_alt',
        title: 'Orden finalizada',
        subtitle: 'Tu servicio ya llegó a su última etapa.',
      });
    }

    return items;
  });

  readonly notificationBadgeCount = computed(() => this.processNotifications().length);

  readonly chatItems = computed<ChatRenderItem[]>(() => {
    const messages = [...(this.selectedOtDetalle()?.mensajes ?? [])].sort(
      (a, b) => this.toMillis(a.createdAt) - this.toMillis(b.createdAt)
    );

    return messages.map((message, index) => {
      const prev = messages[index - 1];
      const isMine = this.isClienteMsg(message);

      const sameSenderAsPrev =
        !!prev &&
        this.normalizeStatus(prev.remitenteTipo) === this.normalizeStatus(message.remitenteTipo) &&
        (prev.remitenteNombre || '').trim() === (message.remitenteNombre || '').trim();

      const sameDayAsPrev = !!prev && this.sameLocalDay(prev.createdAt, message.createdAt);

      return {
        id: message.id || `${index}-${message.createdAt}-${message.contenido}`,
        message,
        isMine,
        showMeta: !isMine && (!sameSenderAsPrev || !sameDayAsPrev),
        showDayDivider: !prev || !sameDayAsPrev,
        dayLabel: this.getChatDayLabel(message.createdAt),
      };
    });
  });

  readonly footerSection = computed<'home' | 'presupuesto' | 'cita' | 'pago' | 'chat'>(() => {
    if (this.portalView() !== 'order') return 'home';
    return this.activeOrderSection();
  });

  private readonly stepRank: Record<StepKey, number> = {
    RECIBIDA: 0,
    PRESUPUESTO: 1,
    APROBADA: 2,
    EN_CURSO: 3,
    FINALIZADA: 4,
  };

  private readonly modeLabels: Record<string, string> = {
    TIENDA: 'Tienda',
    DOMICILIO: 'Domicilio',
  };

  private readonly priorityLabels: Record<string, string> = {
    BAJA: 'Baja',
    MEDIA: 'Media',
    ALTA: 'Alta',
  };

  private readonly presupuestoLabels: Record<string, string> = {
    BORRADOR: 'Borrador',
    ENVIADO: 'Enviado',
    ACEPTADO: 'Aceptado',
    RECHAZADO: 'Rechazado',
  };

  private readonly pagoLabels: Record<string, string> = {
    PENDIENTE: 'Pendiente',
    MARCADO_TRANSFERENCIA: 'Pago marcado',
    COMPROBANTE_SUBIDO: 'Comprobante subido',
    CONFIRMADO: 'Pago confirmado',
  };

  private readonly citaLabels: Record<string, string> = {
    PROGRAMADA: 'Programada',
    REPROGRAMADA: 'Reprogramada',
    CANCELADA: 'Cancelada',
    COMPLETADA: 'Completada',
  };

  private readonly otNameCache = signal<Record<string, string>>({});
  private readonly otPrefetchInFlight = new Set<string>();

  private detailPollHandle: ReturnType<typeof setInterval> | null = null;
  private listPollHandle: ReturnType<typeof setInterval> | null = null;
  private fastAwaitHandle: ReturnType<typeof setInterval> | null = null;
  private fastAwaitUntil = 0;

  private detailInFlight = false;
  private listInFlight = false;
  private pendingBeforeOtCodes: Set<string> | null = null;
  private initialEntryResolved = false;

  private scrollRequested = false;
  private scrollForce = false;

  private readonly visibilityHandler = () => {
    if (document.visibilityState === 'visible') {
      void this.silentWarmRefresh();
    }
  };

  constructor(
    private readonly auth: AuthService,
    private readonly otService: OtService,
    private readonly ticketsService: TicketsService,
    private readonly router: Router,
    private readonly dialog: MatDialog
  ) {
    this.userDisplayName.set(this.resolveUserDisplayName());
    void this.refreshAll();
  }

  ngOnInit(): void {
    this.detailPollHandle = setInterval(() => {
      void this.pollDetailTick();
    }, 8000);

    this.listPollHandle = setInterval(() => {
      void this.pollListTick();
    }, 25000);

    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  ngOnDestroy(): void {
    if (this.detailPollHandle) clearInterval(this.detailPollHandle);
    if (this.listPollHandle) clearInterval(this.listPollHandle);
    if (this.fastAwaitHandle) clearInterval(this.fastAwaitHandle);

    this.detailPollHandle = null;
    this.listPollHandle = null;
    this.fastAwaitHandle = null;

    document.removeEventListener('visibilitychange', this.visibilityHandler);
  }

  ngAfterViewChecked(): void {
    if (!this.scrollRequested) return;

    if (this.scrollForce || this.isChatNearBottom(90)) {
      this.scrollToBottom();
    }

    this.scrollRequested = false;
    this.scrollForce = false;
  }

  @HostListener('window:scroll')
  handleWindowScroll(): void {
    if (this.portalView() !== 'order') return;

    const threshold = 124;
    const sections: Array<{ section: OrderSection; ref?: ElementRef<HTMLElement> }> = [
      { section: 'presupuesto', ref: this.budgetSectionRef },
      { section: 'cita', ref: this.citaSectionRef },
      { section: 'pago', ref: this.paymentSectionRef },
      { section: 'chat', ref: this.chatSectionRef },
    ];

    let resolved: OrderSection = 'presupuesto';

    for (const item of sections) {
      const top = item.ref?.nativeElement?.getBoundingClientRect().top;
      if (typeof top === 'number' && top <= threshold) {
        resolved = item.section;
      }
    }

    if (resolved !== this.activeOrderSection()) {
      this.setActiveOrderSection(resolved);
    }
  }

  trackById(index: number, item: unknown): string | number {
    if (typeof item === 'string') return `${index}-${item}`;
    if (typeof item === 'number') return item;

    if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      const value =
        record['id'] ??
        record['codigo'] ??
        record['fecha'] ??
        record['createdAt'] ??
        record['updatedAt'];

      if (typeof value === 'string' || typeof value === 'number') {
        return value;
      }
    }

    return index;
  }

  sendReady(): boolean {
    const value = (this.msgForm.value.contenido ?? '').trim();
    return value.length > 0;
  }

  goHome(): void {
    if (this.portalView() === 'order') {
      this.lastOrderSection.set(this.activeOrderSection());
    }

    this.portalView.set('home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async resumeActiveOrder(): Promise<void> {
    const target = this.lastOrderSection();

    if (target === 'chat') {
      await this.goToChat();
      return;
    }

    if (target === 'cita') {
      await this.goToCita();
      return;
    }

    if (target === 'pago') {
      await this.goToPago();
      return;
    }

    await this.goToBudget();
  }

  async goToTicket(): Promise<void> {
    const ok = await this.ensureCurrentOtLoaded();
    if (!ok) return;

    this.portalView.set('order');
    this.setActiveOrderSection('presupuesto');

    this.afterOrderViewReady(() => {
      const top = this.getScrollTopFor(this.orderTopRef);
      if (top === null) return;

      window.scrollTo({
        top,
        behavior: 'smooth',
      });
    });
  }

  async goToBudget(): Promise<void> {
    const ok = await this.ensureCurrentOtLoaded();
    if (!ok) return;

    this.portalView.set('order');
    this.scrollIntoView(this.budgetSectionRef, 'presupuesto');
  }

  async goToCita(): Promise<void> {
    const ok = await this.ensureCurrentOtLoaded();
    if (!ok) return;

    this.portalView.set('order');
    this.scrollIntoView(this.citaSectionRef, 'cita');
  }

  async goToPago(): Promise<void> {
    const ok = await this.ensureCurrentOtLoaded();
    if (!ok) return;

    this.portalView.set('order');
    this.scrollIntoView(this.paymentSectionRef, 'pago');
  }

  async goToChat(): Promise<void> {
    const ok = await this.ensureCurrentOtLoaded();
    if (!ok) return;

    this.portalView.set('order');
    this.scrollIntoView(this.chatSectionRef, 'chat');
    this.requestScroll(true);

    setTimeout(() => {
      this.chatInput?.nativeElement?.focus();
    }, 220);
  }

  async selectOtChip(codigo: string): Promise<void> {
    if (!codigo) return;

    this.selectedOtCodigoSignal.set(codigo);
    await this.loadDetalle(codigo, {
      forceScroll: false,
      animate: true,
    });

    this.portalView.set('order');
    this.setActiveOrderSection('presupuesto');

    this.afterOrderViewReady(() => {
      const top = this.getScrollTopFor(this.orderTopRef);
      if (top === null) return;

      window.scrollTo({
        top,
        behavior: 'smooth',
      });
    });
  }

  handleProcessNotification(item: ProcessNotificationItem): void {
    switch (item.kind) {
      case 'presupuesto':
        void this.goToBudget();
        break;
      case 'cita':
        void this.goToCita();
        break;
      case 'pago':
        void this.goToPago();
        break;
      case 'chat':
        void this.goToChat();
        break;
      case 'estado':
        void this.goToTicket();
        break;
      case 'pending-ticket':
      default:
        this.portalView.set('success');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        break;
    }
  }

  openNewTicket(): void {
    const beforeCodes = new Set(
      this.ots()
        .map((item) => String(item.codigo ?? '').trim())
        .filter((codigo) => codigo.length > 0)
    );

    const ref = this.openTicketDialog({ mode: 'new' });

    ref.afterClosed().subscribe(async (ticket?: TicketDetalleDto) => {
      if (!ticket) return;

      this.submittedTicket.set(ticket);
      this.pendingTicket.set(ticket);
      this.pendingBeforeOtCodes = beforeCodes;
      this.portalView.set('success');
      this.setActiveOrderSection('presupuesto');

      window.scrollTo({ top: 0, behavior: 'auto' });

      this.snackBar.open('Solicitud enviada correctamente', undefined, {
        duration: 1800,
        panelClass: ['rs-snack-pro'],
        verticalPosition: 'bottom',
        horizontalPosition: 'center',
      });

      await Promise.all([
        this.loadTickets({ silent: true, quiet: true }),
        this.loadOts({
          silent: true,
          quiet: true,
          preserveSelection: true,
          autoLoadDetalle: false,
        }),
      ]);

      const opened = await this.tryDetectAndOpenNewOt({
        silent: true,
        quiet: true,
      });

      if (!opened) {
        this.startFastAwait();
      }
    });
  }

  async openTicket(ticketId: string): Promise<void> {
    try {
      const detail = await this.ticketsService.obtener(ticketId);
      this.openTicketDialog({ mode: 'view', ticket: detail });
    } catch {
      this.snackBar.open('No se pudo cargar la solicitud', 'Cerrar', {
        duration: 2500,
        panelClass: ['rs-snack-pro'],
      });
    }
  }

  logout(): void {
    void this.auth.logout();
    void this.router.navigateByUrl('/login');
  }

  onPagoFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.pagoFile.set(input.files?.[0] ?? null);
  }

  copyToClipboard(text: string): void {
    if (!navigator.clipboard) {
      this.snackBar.open('Tu navegador no permite copiar automáticamente', 'Cerrar', {
        duration: 2200,
        panelClass: ['rs-snack-pro'],
      });
      return;
    }

    navigator.clipboard.writeText(text).then(
      () => {
        this.snackBar.open('Copiado al portapapeles', undefined, {
          duration: 1400,
          panelClass: ['rs-snack-pro'],
        });
      },
      () => {
        this.snackBar.open('No se pudo copiar', 'Cerrar', {
          duration: 2000,
          panelClass: ['rs-snack-pro'],
        });
      }
    );
  }

  async aceptar(otId: string): Promise<void> {
    if (!this.aceptoCheck()) return;

    this.actionBusy.set(true);
    try {
      await this.otService.aceptarPresupuesto(otId);
      await this.loadDetalle(otId, { forceScroll: false, animate: false });
      this.snackBar.open('Presupuesto aceptado', undefined, {
        duration: 1400,
        panelClass: ['rs-snack-pro'],
      });
    } catch {
      this.snackBar.open('Error al aceptar', 'Cerrar', {
        duration: 2500,
        panelClass: ['rs-snack-pro'],
      });
    } finally {
      this.actionBusy.set(false);
    }
  }

  async rechazar(otId: string): Promise<void> {
    this.actionBusy.set(true);
    try {
      await this.otService.rechazarPresupuesto(otId);
      await this.loadDetalle(otId, { forceScroll: false, animate: false });
      this.snackBar.open('Presupuesto rechazado', undefined, {
        duration: 1400,
        panelClass: ['rs-snack-pro'],
      });
    } catch {
      this.snackBar.open('Error al rechazar', 'Cerrar', {
        duration: 2500,
        panelClass: ['rs-snack-pro'],
      });
    } finally {
      this.actionBusy.set(false);
    }
  }

  async marcarTransferencia(otId: string): Promise<void> {
    this.actionBusy.set(true);
    try {
      await this.otService.marcarTransferencia(otId);
      await this.loadDetalle(otId, { forceScroll: false, animate: false });
      this.snackBar.open('Pago marcado correctamente', undefined, {
        duration: 1400,
        panelClass: ['rs-snack-pro'],
      });
    } catch {
      this.snackBar.open('Error al confirmar pago', 'Cerrar', {
        duration: 2500,
        panelClass: ['rs-snack-pro'],
      });
    } finally {
      this.actionBusy.set(false);
    }
  }

  async uploadComprobante(otId: string): Promise<void> {
    const file = this.pagoFile();
    if (!file) return;

    this.actionBusy.set(true);
    try {
      await this.otService.subirComprobantePago(otId, file);
      this.pagoFile.set(null);
      await this.loadDetalle(otId, { forceScroll: false, animate: false });
      this.snackBar.open('Recibo enviado correctamente', undefined, {
        duration: 1400,
        panelClass: ['rs-snack-pro'],
      });
    } catch {
      this.snackBar.open('Error al subir el recibo', 'Cerrar', {
        duration: 2500,
        panelClass: ['rs-snack-pro'],
      });
    } finally {
      this.actionBusy.set(false);
    }
  }

  async sendMessage(): Promise<void> {
    const ot = this.selectedOtDetalle();
    if (!ot) return;

    await this.sendMsgOt(this.getCurrentOtActionId(ot));
  }

  presupuestoEstadoLabel(value?: string | null): string {
    return this.presupuestoLabels[this.normalizeStatus(value)] ?? 'Sin estado';
  }

  citaEstadoLabel(value?: string | null): string {
    return this.citaLabels[this.normalizeStatus(value)] ?? 'Sin estado';
  }

  pagoEstadoLabel(value?: string | null): string {
    return this.pagoLabels[this.normalizeStatus(value)] ?? 'Sin estado';
  }

  serviceModeLabel(ot: OtDetalleDto | null): string | null {
    if (!ot?.tipo) return null;
    return this.modeLabels[this.normalizeStatus(ot.tipo)] ?? this.formatLabel(ot.tipo);
  }

  servicePriorityLabel(ot: OtDetalleDto | null): string | null {
    if (!ot?.prioridad) return null;
    return this.priorityLabels[this.normalizeStatus(ot.prioridad)] ?? this.formatLabel(ot.prioridad);
  }

  serviceStatusLabel(ot: OtDetalleDto | null): string {
    const status = this.normalizeStatus(ot?.estado);

    switch (status) {
      case 'RECIBIDA':
        return 'Solicitud recibida';
      case 'PRESUPUESTO':
        return 'Presupuesto listo';
      case 'APROBADA':
        return 'Orden aprobada';
      case 'EN_CURSO':
        return 'En proceso';
      case 'FINALIZADA':
      case 'CERRADA':
        return 'Servicio finalizado';
      default:
        return 'Estado';
    }
  }

  getOtDisplayName(ot?: ClienteOtItemDto | null, detail?: OtDetalleDto | null): string {
    const detailName = (detail?.equipo ?? '').trim();
    if (detailName.length > 0) return detailName;

    const codigo = (detail?.codigo ?? ot?.codigo ?? '').trim();
    const cache = this.otNameCache();

    if (codigo && cache[codigo]) {
      return cache[codigo];
    }

    return 'Equipo';
  }

  getOtChipLabel(item: ClienteOtItemDto): string {
    const selectedDetail = this.selectedOtDetalle();
    if (selectedDetail?.codigo === item.codigo) {
      return this.getOtDisplayName(item, selectedDetail);
    }

    const cache = this.otNameCache();
    if (cache[item.codigo]) return cache[item.codigo];

    return 'Equipo';
  }

  getOtChipIcon(ot?: ClienteOtItemDto | null, detail?: OtDetalleDto | null): string {
    const label = this.getOtDisplayName(ot, detail).toLowerCase();

    if (label.includes('televisor') || label.includes('tv')) return 'tv';
    if (label.includes('laptop') || label.includes('portátil') || label.includes('portatil')) return 'laptop_mac';
    if (label.includes('celular') || label.includes('teléfono') || label.includes('telefono')) return 'smartphone';
    if (label.includes('monitor')) return 'desktop_windows';
    if (label.includes('impresora')) return 'print';
    if (label.includes('router') || label.includes('módem') || label.includes('modem')) return 'router';
    if (
      label.includes('consola') ||
      label.includes('xbox') ||
      label.includes('playstation') ||
      label.includes('switch')
    ) {
      return 'sports_esports';
    }
    if (
      label.includes('cpu') ||
      label.includes('pc') ||
      label.includes('computadora') ||
      label.includes('computador')
    ) {
      return 'memory';
    }

    return 'devices_other';
  }

  buildServiceBadges(ot: OtDetalleDto | null): string[] {
    if (!ot) return [];

    const badges: string[] = [];
    const mode = this.serviceModeLabel(ot);
    const priority = this.servicePriorityLabel(ot);
    const category = (ot.categoriaEquipoNombre ?? '').trim();

    if (mode) badges.push(mode);
    if (priority) badges.push(priority);
    if (category) badges.push(category);

    //  --- NUEVO: AÑADIR LAS CATEGORÍAS ---
    if (ot.categoriasTrabajo && ot.categoriasTrabajo.length > 0) {
      ot.categoriasTrabajo.forEach(cat => {
        // FormatLabel convertirá "MANTENIMIENTO" en "Mantenimiento"
        badges.push(this.formatLabel(cat)); 
      });
    }

    return badges;
  }

  isClienteMsg(message: MensajeDto): boolean {
    return this.normalizeStatus(message.remitenteTipo) === 'CLIENTE';
  }

  getSenderName(message: MensajeDto): string {
    return (message.remitenteNombre || '').trim() || 'Técnico';
  }

  getCurrentOtActionId(ot: OtDetalleDto): string {
    return ot.id || ot.codigo;
  }

  async refreshAll(): Promise<void> {
    await Promise.all([
      this.loadOts({ preserveSelection: true, autoLoadDetalle: true }),
      this.loadTickets(),
    ]);

    if (!this.initialEntryResolved) {
      this.resolveInitialPortalView();
      this.initialEntryResolved = true;
    }
  }

  private async loadOts(opts: LoadOpts = {}): Promise<void> {
    const clienteId = this.auth.getClienteId();
    if (!clienteId) return;

    const showSpinner = !opts.silent;
    if (showSpinner) this.loading.set(true);

    try {
      const response = await this.otService.listarMisOts(0, 50);
      this.ots.set(response.items);

      const wanted = opts.preserveSelection
        ? this.selectedOtCodigoSignal() ?? this.selectedOtDetalle()?.codigo ?? null
        : this.selectedOtCodigoSignal();

      const exists = !!wanted && response.items.some((item) => item.codigo === wanted);
      const nextCodigo = exists ? wanted : response.items[0]?.codigo ?? null;

      this.selectedOtCodigoSignal.set(nextCodigo);

      if (opts.autoLoadDetalle !== false) {
        const shouldLoad =
          !this.selectedOtDetalle() ||
          (nextCodigo !== null && this.selectedOtDetalle()?.codigo !== nextCodigo);

        if (shouldLoad && nextCodigo) {
          await this.loadDetalle(nextCodigo, {
            silent: true,
            quiet: opts.quiet,
            forceScroll: !!opts.forceScroll,
            animate: !!opts.animate,
          });
        }
      }

      void this.prefetchOtNames(response.items);
    } catch {
      if (!opts.quiet) {
        this.snackBar.open('No se pudieron cargar tus servicios', 'Cerrar', {
          duration: 2500,
          panelClass: ['rs-snack-pro'],
        });
      }
    } finally {
      if (showSpinner) this.loading.set(false);
    }
  }

  private async loadTickets(opts: LoadOpts = {}): Promise<void> {
    const clienteId = this.auth.getClienteId();
    if (!clienteId) return;

    const showSpinner = !opts.silent;
    if (showSpinner) this.loading.set(true);

    try {
      const response = await this.ticketsService.listar(0, 50);
      this.tickets.set(response.items);
    } catch {
      if (!opts.quiet) {
        this.snackBar.open('No se pudieron cargar tus solicitudes', 'Cerrar', {
          duration: 2500,
          panelClass: ['rs-snack-pro'],
        });
      }
    } finally {
      if (showSpinner) this.loading.set(false);
    }
  }

  private async loadDetalle(idOrCodigo: string, opts: LoadOpts = {}): Promise<void> {
    const showSpinner = !opts.silent;
    if (showSpinner) this.loading.set(true);

    try {
      const detail = await this.otService.obtenerDetalle(idOrCodigo);
      this.selectedOtDetalle.set(detail);
      this.selectedOtCodigoSignal.set(detail.codigo);
      this.aceptoCheck.set(false);

      const detailName = (detail.equipo ?? '').trim();
      if (detail.codigo && detailName) {
        this.otNameCache.update((current) => ({
          ...current,
          [detail.codigo]: detailName,
        }));
      }

      if (opts.animate) {
        this.triggerFadeIn();
      }

      if (opts.forceScroll) {
        this.requestScroll(true);
      }
    } catch {
      if (!opts.quiet) {
        this.snackBar.open('No se pudo cargar el detalle de la orden', 'Cerrar', {
          duration: 2500,
          panelClass: ['rs-snack-pro'],
        });
      }
    } finally {
      if (showSpinner) this.loading.set(false);
    }
  }

  private async prefetchOtNames(items: ClienteOtItemDto[]): Promise<void> {
    const cache = this.otNameCache();
    const targets = items
      .slice(0, 8)
      .map((item) => item.codigo)
      .filter((codigo) => !!codigo && !cache[codigo] && !this.otPrefetchInFlight.has(codigo));

    if (!targets.length) return;

    await Promise.allSettled(
      targets.map(async (codigo) => {
        this.otPrefetchInFlight.add(codigo);

        try {
          const detail = await this.otService.obtenerDetalle(codigo);
          const name = (detail.equipo ?? '').trim();

          if (detail.codigo && name) {
            this.otNameCache.update((current) => ({
              ...current,
              [detail.codigo]: name,
            }));
          }
        } catch {
          // silencioso
        } finally {
          this.otPrefetchInFlight.delete(codigo);
        }
      })
    );
  }

  private async tryDetectAndOpenNewOt(opts: LoadOpts = {}): Promise<boolean> {
    await this.loadOts({
      silent: true,
      quiet: true,
      preserveSelection: true,
      autoLoadDetalle: false,
    });

    const beforeCodes = this.pendingBeforeOtCodes;
    if (!beforeCodes) return false;

    const newOt = this.ots().find((item) => !beforeCodes.has(item.codigo));
    if (!newOt?.codigo) return false;

    this.pendingTicket.set(null);
    this.pendingBeforeOtCodes = null;
    this.stopFastAwait();

    await this.loadDetalle(newOt.codigo, {
      silent: opts.silent,
      quiet: opts.quiet,
      forceScroll: false,
      animate: false,
    });

    this.portalView.set('order');
    this.setActiveOrderSection('presupuesto');

    this.afterOrderViewReady(() => {
      const top = this.getScrollTopFor(this.orderTopRef);
      if (top === null) return;

      window.scrollTo({
        top,
        behavior: 'smooth',
      });
    });

    return true;
  }

  private async ensureCurrentOtLoaded(): Promise<boolean> {
    const current = this.selectedOtDetalle();
    if (current?.codigo) return true;

    const firstCodigo = this.selectedOtCodigoSignal() ?? this.ots()[0]?.codigo ?? null;
    if (!firstCodigo) {
      this.snackBar.open('Aún no tienes una orden disponible', 'Cerrar', {
        duration: 2200,
        panelClass: ['rs-snack-pro'],
      });
      return false;
    }

    await this.loadDetalle(firstCodigo, {
      silent: false,
      quiet: false,
      forceScroll: false,
      animate: false,
    });

    return !!this.selectedOtDetalle();
  }

  private async silentWarmRefresh(): Promise<void> {
    await Promise.all([this.pollListTick(), this.pollDetailTick()]);
  }

  private async pollDetailTick(): Promise<void> {
    if (this.detailInFlight || this.loading() || this.actionBusy()) return;

    const codigo = this.selectedOtCodigoSignal() ?? this.selectedOtDetalle()?.codigo ?? null;
    if (!codigo) return;

    this.detailInFlight = true;
    try {
      await this.loadDetalle(codigo, {
        silent: true,
        quiet: true,
        forceScroll: false,
        animate: false,
      });
    } finally {
      this.detailInFlight = false;
    }
  }

  private async pollListTick(): Promise<void> {
    if (this.listInFlight || this.loading() || this.actionBusy()) return;

    this.listInFlight = true;
    try {
      await this.loadOts({
        silent: true,
        quiet: true,
        preserveSelection: true,
        autoLoadDetalle: !this.selectedOtDetalle(),
      });

      await this.loadTickets({ silent: true, quiet: true });

      if (this.pendingTicket()) {
        await this.tryDetectAndOpenNewOt({ silent: true, quiet: true });
      }
    } finally {
      this.listInFlight = false;
    }
  }

  private stopFastAwait(): void {
    if (this.fastAwaitHandle) clearInterval(this.fastAwaitHandle);
    this.fastAwaitHandle = null;
    this.fastAwaitUntil = 0;
  }

  private startFastAwait(): void {
    this.stopFastAwait();
    this.fastAwaitUntil = Date.now() + 120_000;

    this.fastAwaitHandle = setInterval(() => {
      void this.fastAwaitTick();
    }, 5000);

    void this.fastAwaitTick();
  }

  private async fastAwaitTick(): Promise<void> {
    if (!this.pendingTicket() || !this.pendingBeforeOtCodes) {
      this.stopFastAwait();
      return;
    }

    if (Date.now() > this.fastAwaitUntil) {
      this.stopFastAwait();
      return;
    }

    await this.tryDetectAndOpenNewOt({ silent: true, quiet: true });
  }

  private async sendMsgOt(otId: string): Promise<void> {
    const contenido = (this.msgForm.value.contenido ?? '').trim();
    if (!contenido) return;

    this.actionBusy.set(true);
    try {
      await this.otService.enviarMensaje(otId, contenido);
      this.msgForm.reset({ contenido: '' });

      await this.loadDetalle(otId, {
        forceScroll: true,
        animate: false,
      });

      this.setActiveOrderSection('chat');

      setTimeout(() => {
        this.chatInput?.nativeElement?.focus();
      }, 120);
    } catch {
      this.snackBar.open('Error al enviar mensaje', 'Cerrar', {
        duration: 2500,
        panelClass: ['rs-snack-pro'],
      });
    } finally {
      this.actionBusy.set(false);
    }
  }

  private openTicketDialog(data: { mode: 'new' | 'view'; ticket?: TicketDetalleDto }) {
    return this.dialog.open(TicketDialogComponent, {
      data,
      width: 'min(760px, 96vw)',
      maxWidth: '96vw',
      height: 'min(860px, 92dvh)',
      maxHeight: '92dvh',
      autoFocus: false,
      restoreFocus: false,
      panelClass: ['rs-ticket-dialog', 'rs-ticket-dialog-panel'],
    });
  }

  private resolveUserDisplayName(): string {
    const token = this.auth.token();
    if (!token) return 'Cliente';

    const payload = decodeJwt(token) as {
      nombre?: string;
      email?: string;
      usuario?: string;
    };

    const nombre = payload.nombre?.trim();
    if (nombre) return nombre;

    const usuario = payload.usuario?.trim();
    if (usuario) return usuario;

    const email = payload.email?.trim();
    if (email) return email.split('@')[0];

    return 'Cliente';
  }

  private inferWelcomeWord(name: string): string {
    const n = (name || '').trim().toLowerCase();
    if (!n) return 'Bienvenido';

    const probableFemale = [
      'a', 'ia', 'na', 'ela', 'ina', 'ana', 'iana', 'briana', 'maria',
      'gabriela', 'valeria', 'sofia', 'camila', 'paula', 'laura',
    ];

    if (probableFemale.some((item) => n.endsWith(item))) {
      return 'Bienvenida';
    }

    return 'Bienvenido';
  }

  private resolveBusinessStep(
    ot: OtDetalleDto | null,
    listItem: ClienteOtItemDto | null
  ): StepKey {
    if (!ot && !listItem) return 'RECIBIDA';

    const detailKey = this.stepFromRawStatus(ot?.estado);
    const listKey = this.stepFromRawStatus(listItem?.estado);

    let resolved =
      this.stepRank[listKey] < this.stepRank[detailKey] ? listKey : detailKey;

    if (ot?.presupuesto?.estado === 'ENVIADO') {
      return 'PRESUPUESTO';
    }

    if (ot?.presupuesto?.estado === 'ACEPTADO' && this.stepRank[resolved] < this.stepRank.APROBADA) {
      resolved = 'APROBADA';
    }

    return resolved;
  }

  private stepFromRawStatus(statusRaw?: string | null): StepKey {
    const status = this.normalizeStatus(statusRaw);

    switch (status) {
      case 'RECIBIDA':
        return 'RECIBIDA';
      case 'PRESUPUESTO':
        return 'PRESUPUESTO';
      case 'APROBADA':
        return 'APROBADA';
      case 'EN_CURSO':
        return 'EN_CURSO';
      case 'FINALIZADA':
      case 'CERRADA':
        return 'FINALIZADA';
      default:
        return 'RECIBIDA';
    }
  }

  private setActiveOrderSection(section: OrderSection): void {
    this.activeOrderSection.set(section);
    this.lastOrderSection.set(section);
  }

  private requestScroll(force = false): void {
    this.scrollRequested = true;
    this.scrollForce = force;
  }

  private isChatNearBottom(thresholdPx = 80): boolean {
    try {
      const el = this.chatContainer?.nativeElement;
      if (!el) return true;
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      return dist < thresholdPx;
    } catch {
      return true;
    }
  }

  private scrollToBottom(): void {
    try {
      const el = this.chatContainer?.nativeElement;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    } catch {
      // ignore
    }
  }

  private triggerFadeIn(): void {
    this.detailFade.set(false);
    queueMicrotask(() => {
      this.detailFade.set(true);
      setTimeout(() => this.detailFade.set(false), 220);
    });
  }

  private resolveInitialPortalView(): void {
    if (this.pendingTicket()) {
      this.portalView.set('success');
      return;
    }

    this.portalView.set('home');
  }

  private getScrollTopFor(ref?: ElementRef<HTMLElement>): number | null {
    const el = ref?.nativeElement;
    if (!el) return null;

    const top = el.getBoundingClientRect().top + window.scrollY - 84;
    return Math.max(top, 0);
  }

  private afterOrderViewReady(task: () => void): void {
    requestAnimationFrame(() => {
      requestAnimationFrame(task);
    });
  }

  private scrollIntoView(ref: ElementRef<HTMLElement> | undefined, section: OrderSection): void {
    this.setActiveOrderSection(section);

    this.afterOrderViewReady(() => {
      const top = this.getScrollTopFor(ref);
      if (top === null) return;

      window.scrollTo({
        top,
        behavior: 'smooth',
      });
    });
  }

  private normalizeStatus(value?: string | null): string {
    return (value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '_');
  }

  private formatLabel(value?: string | null): string {
    const normalized = (value ?? '').trim().replace(/_/g, ' ').toLowerCase();
    if (!normalized) return '';
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  private toMillis(value?: string | null): number {
    const n = value ? new Date(value).getTime() : 0;
    return Number.isFinite(n) ? n : 0;
  }

  private sameLocalDay(a?: string | null, b?: string | null): boolean {
    if (!a || !b) return false;

    const da = new Date(a);
    const db = new Date(b);

    return (
      da.getFullYear() === db.getFullYear() &&
      da.getMonth() === db.getMonth() &&
      da.getDate() === db.getDate()
    );
  }

  private getChatDayLabel(value?: string | null): string {
    if (!value) return '';

    const d = new Date(value);
    const now = new Date();

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const target = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diffDays = Math.round((today - target) / 86_400_000);

    if (diffDays === 0) return 'Hoy';
    if (diffDays === 1) return 'Ayer';

    return d.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }
}