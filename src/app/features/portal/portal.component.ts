import {
  Component,
  signal,
  inject,
  computed,
  ViewChild,
  ElementRef,
  AfterViewChecked,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder } from '@angular/forms';
import { Router } from '@angular/router';

import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatMenuModule } from '@angular/material/menu';
import { MatBadgeModule } from '@angular/material/badge';

import { AuthService } from '../../core/auth.service';
import { OtService } from '../../core/ot.service';
import { TicketsService } from '../../core/tickets.service';

import {
  ClienteOtItemDto,
  OtDetalleDto,
  TicketListaItemDto,
  TicketDetalleDto,
  MensajeDto,
  CitaDto,
} from '../../core/models';

import { TicketDialogComponent } from './ticket-dialog/ticket-dialog.component';

type StepKey =
  | 'RECIBIDA'
  | 'PRESUPUESTO'
  | 'APROBADA'
  | 'EN_CURSO'
  | 'FINALIZADA';

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
  showAvatar: boolean;
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

  private fb = inject(FormBuilder);
  private snackBar = inject(MatSnackBar);

  loading = signal(false);
  actionBusy = signal(false);

  portalView = signal<PortalView>('home');
  activeOrderSection = signal<OrderSection>('presupuesto');
  userDisplayName = signal('Cliente');

  ots = signal<ClienteOtItemDto[]>([]);
  tickets = signal<TicketListaItemDto[]>([]);
  selectedOtDetalle = signal<OtDetalleDto | null>(null);
  selectedOtCodigoSignal = signal<string | null>(null);

  aceptoCheck = signal(false);
  pagoFile = signal<File | null>(null);
  detailFade = signal(false);

  pendingTicket = signal<TicketDetalleDto | null>(null);
  submittedTicket = signal<TicketDetalleDto | null>(null);
  private pendingBeforeOtCodes: Set<string> | null = null;
  private initialEntryResolved = false;

  msgForm = this.fb.group({
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
      desc: 'Accede a presupuestos, citas, pagos y chat directo con técnicos especializados.',
    },
  ];

  readonly steps: { key: StepKey; label: string; icon: string }[] = [
    { key: 'RECIBIDA', label: 'Recibida', icon: 'inventory_2' },
    { key: 'PRESUPUESTO', label: 'Presupuesto', icon: 'request_quote' },
    { key: 'APROBADA', label: 'Aprobada', icon: 'verified' },
    { key: 'EN_CURSO', label: 'En proceso', icon: 'build' },
    { key: 'FINALIZADA', label: 'Finalizada', icon: 'task_alt' },
  ];

  private readonly stepRank: Record<StepKey, number> = {
    RECIBIDA: 0,
    PRESUPUESTO: 1,
    APROBADA: 2,
    EN_CURSO: 3,
    FINALIZADA: 4,
  };

  private detailPollHandle: ReturnType<typeof setInterval> | null = null;
  private listPollHandle: ReturnType<typeof setInterval> | null = null;
  private fastAwaitHandle: ReturnType<typeof setInterval> | null = null;
  private fastAwaitUntil = 0;

  private detailInFlight = false;
  private listInFlight = false;

  private visibilityHandler = () => {
    if (document.visibilityState === 'visible') {
      this.silentWarmRefresh();
    }
  };

  selectedOtListItem = computed<ClienteOtItemDto | null>(() => {
    const codigo = this.selectedOtCodigoSignal();
    if (!codigo) return null;
    return this.ots().find((o) => o.codigo === codigo) ?? null;
  });

  firstName = computed(() => {
    const raw = (this.userDisplayName() || 'Cliente').trim();
    return raw.split(/\s+/)[0] || 'Cliente';
  });

  profileInitial = computed(() => this.firstName().charAt(0).toUpperCase() || 'C');

  activeServiceTitle = computed<string>(() => {
    const ot = this.selectedOtDetalle();
    const listItem = this.selectedOtListItem();
    return this.getOtDisplayName(listItem, ot);
  });

  stepKey = computed<StepKey>(() =>
    this.resolveBusinessStep(this.selectedOtDetalle(), this.selectedOtListItem())
  );

  stepIndex = computed(() => this.stepRank[this.stepKey()]);

  nextCita = computed<CitaDto | null>(() => {
    const citas = this.selectedOtDetalle()?.citas ?? [];
    if (!citas.length) return null;

    const sorted = [...citas].sort(
      (a, b) => this.toMillis(a.inicio) - this.toMillis(b.inicio)
    );

    return sorted[0] ?? null;
  });

  quickUnreadCount = computed<number>(() => {
    const msgs = this.selectedOtDetalle()?.mensajes ?? [];
    return msgs.filter((m) => !this.isClienteMsg(m)).length;
  });

  processNotifications = computed<ProcessNotificationItem[]>(() => {
    const items: ProcessNotificationItem[] = [];
    const ot = this.selectedOtDetalle();

    if (this.pendingTicket()) {
      items.push({
        kind: 'pending-ticket',
        icon: 'schedule',
        title: 'Solicitud recibida',
        subtitle: 'Tu ticket fue registrado correctamente.',
      });
    }

    if (!ot) return items;

    const presupuestoEstado = this.normalizeStatus(ot.presupuesto?.estado);

    if (['ENVIADO', 'PENDIENTE'].includes(presupuestoEstado)) {
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
        subtitle: 'Ya tienes una visita confirmada.',
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

  notificationBadgeCount = computed<number>(() => this.processNotifications().length);

  chatItems = computed<ChatRenderItem[]>(() => {
    const ot = this.selectedOtDetalle();
    const messages = [...(ot?.mensajes ?? [])].sort(
      (a, b) => this.toMillis(a.createdAt) - this.toMillis(b.createdAt)
    );

    return messages.map((message, index) => {
      const prev = messages[index - 1];
      const isMine = this.isClienteMsg(message);

      const sameSenderAsPrev =
        !!prev &&
        this.normalizeStatus(prev.remitenteTipo) ===
          this.normalizeStatus(message.remitenteTipo) &&
        (prev.remitenteNombre || '').trim() ===
          (message.remitenteNombre || '').trim();

      const sameDayAsPrev = !!prev && this.sameLocalDay(prev.createdAt, message.createdAt);

      const showDayDivider = !prev || !sameDayAsPrev;
      const showMeta = !isMine && (!sameSenderAsPrev || !sameDayAsPrev);

      return {
        id:
          (message as any)?.id ??
          `${index}-${message.createdAt}-${message.contenido}`,
        message,
        isMine,
        showAvatar: showMeta,
        showMeta,
        showDayDivider,
        dayLabel: this.getChatDayLabel(message.createdAt),
      };
    });
  });

  sendReady = computed<boolean>(() => {
    const value = (this.msgForm.value.contenido ?? '').trim();
    return value.length > 0;
  });

  footerSection = computed<'home' | 'presupuesto' | 'cita' | 'pago' | 'chat'>(() => {
    if (this.portalView() !== 'order') return 'home';
    return this.activeOrderSection();
  });

  private scrollRequested = false;
  private scrollForce = false;

  constructor(
    private auth: AuthService,
    private otService: OtService,
    private ticketsService: TicketsService,
    private router: Router,
    private dialog: MatDialog
  ) {
    this.userDisplayName.set(this.resolveUserDisplayName());
    this.refreshAll();
  }

  ngOnInit(): void {
    this.detailPollHandle = setInterval(() => {
      this.pollDetailTick();
    }, 8000);

    this.listPollHandle = setInterval(() => {
      this.pollListTick();
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

  trackById(index: number, item: any): any {
    return item?.id ?? item?.codigo ?? item?.fecha ?? item?.createdAt ?? index;
  }

  private resolveUserDisplayName(): string {
    const authAny = this.auth as any;

    const candidates: unknown[] = [
      authAny?.currentUser?.()?.nombreCompleto,
      authAny?.currentUser?.()?.nombre,
      authAny?.currentUser?.()?.name,
      authAny?.usuarioActual?.nombreCompleto,
      authAny?.usuarioActual?.nombre,
      authAny?.usuario?.nombreCompleto,
      authAny?.usuario?.nombre,
      authAny?.user?.name,
      authAny?.user?.nombre,
      authAny?.profile?.name,
      authAny?.profile?.nombre,
    ];

    for (const key of ['auth_user', 'user', 'session', 'currentUser', 'auth']) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        candidates.push(
          parsed?.nombreCompleto,
          parsed?.nombre,
          parsed?.name,
          parsed?.usuario?.nombre,
          parsed?.user?.name
        );
      } catch {
        // ignore
      }
    }

    const found = candidates.find(
      (value) => typeof value === 'string' && value.trim().length > 0
    );

    return found ? String(found).trim() : 'Cliente';
  }

  private normalizeStatus(value?: string | null): string {
    return (value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '_');
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
    const diffDays = Math.round((today - target) / 86400000);

    if (diffDays === 0) return 'Hoy';
    if (diffDays === 1) return 'Ayer';

    return d.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  private stepFromRawStatus(statusRaw?: string | null): StepKey {
    const e = this.normalizeStatus(statusRaw);

    if (['NUEVA', 'RECIBIDA', 'RECIBIDO', 'CREADA', 'REGISTRADA'].includes(e)) {
      return 'RECIBIDA';
    }

    if (
      ['PRESUPUESTO', 'ENVIADO', 'PENDIENTE', 'COTIZACION'].includes(e) ||
      e.includes('PRESUP')
    ) {
      return 'PRESUPUESTO';
    }

    if (
      ['APROBADA', 'ACEPTADO', 'APROBADO', 'ACEPTADA'].includes(e) ||
      e.includes('APROB') ||
      e.includes('ACEPT')
    ) {
      return 'APROBADA';
    }

    if (
      ['EN_CURSO', 'REPARANDO', 'EN_REPARACION', 'REPARACION', 'EN_PROCESO'].includes(e) ||
      e.includes('CURSO') ||
      e.includes('REPAR')
    ) {
      return 'EN_CURSO';
    }

    if (
      ['FINALIZADA', 'LISTO', 'TERMINADA', 'FINALIZADO', 'ENTREGADA', 'ENTREGADO'].includes(e) ||
      e.includes('FINAL') ||
      e.includes('TERMIN') ||
      e.includes('LIST')
    ) {
      return 'FINALIZADA';
    }

    return 'RECIBIDA';
  }

  private friendlyStateLabel(value?: string | null): string {
    const e = this.normalizeStatus(value);

    if (['NUEVA', 'RECIBIDA', 'RECIBIDO', 'CREADA', 'REGISTRADA'].includes(e)) {
      return 'Solicitud recibida';
    }

    if (
      ['PRESUPUESTO', 'ENVIADO', 'PENDIENTE', 'COTIZACION'].includes(e) ||
      e.includes('PRESUP')
    ) {
      return 'Presupuesto listo';
    }

    if (
      ['APROBADA', 'ACEPTADO', 'APROBADO', 'ACEPTADA'].includes(e) ||
      e.includes('APROB') ||
      e.includes('ACEPT')
    ) {
      return 'Orden aprobada';
    }

    if (
      ['EN_CURSO', 'REPARANDO', 'EN_REPARACION', 'REPARACION', 'EN_PROCESO'].includes(e) ||
      e.includes('CURSO') ||
      e.includes('REPAR')
    ) {
      return 'Diagnóstico en curso';
    }

    if (
      ['FINALIZADA', 'LISTO', 'TERMINADA', 'FINALIZADO', 'ENTREGADA', 'ENTREGADO'].includes(e) ||
      e.includes('FINAL')
    ) {
      return 'Servicio finalizado';
    }

    return value || 'Estado';
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

    const presEstado = this.normalizeStatus(ot?.presupuesto?.estado);

    if (['ENVIADO', 'PENDIENTE'].includes(presEstado)) {
      return 'PRESUPUESTO';
    }

    if (
      ['APROBADA', 'ACEPTADO', 'APROBADO', 'ACEPTADA'].includes(presEstado) &&
      this.stepRank[resolved] < this.stepRank.APROBADA
    ) {
      resolved = 'APROBADA';
    }

    return resolved;
  }

  getFriendlyTicketStatus(value?: string | null): string {
    return this.friendlyStateLabel(value);
  }

  getOtDisplayName(
    ot?: ClienteOtItemDto | null,
    detail?: OtDetalleDto | null
  ): string {
    const candidates = [
      (detail as any)?.equipo,
      (detail as any)?.titulo,
      (detail as any)?.nombreEquipo,
      (detail as any)?.asunto,
      (ot as any)?.equipo,
      (ot as any)?.titulo,
      (ot as any)?.nombreEquipo,
      (ot as any)?.asunto,
      (detail as any)?.descripcion,
    ];

    const found = candidates.find((v) => typeof v === 'string' && v.trim().length > 0);
    if (found) return String(found).trim();

    return 'Equipo';
  }

  serviceMetaLine(ot: OtDetalleDto | null): string {
    const current: any = ot ?? {};
    const parts: string[] = [];

    if (current?.tipo) parts.push(String(current.tipo));
    if (current?.prioridad) parts.push(String(current.prioridad));

    return parts.join(' · ');
  }

  isClienteMsg(m: MensajeDto): boolean {
    return this.normalizeStatus(m.remitenteTipo) === 'CLIENTE';
  }

  getSenderName(m: MensajeDto): string {
    return (m.remitenteNombre || '').trim() || 'Técnico';
  }

  getCurrentOtActionId(ot: OtDetalleDto): string {
    return ((ot as any)?.id ?? ot.codigo) as string;
  }

  private scrollIntoView(
    ref: ElementRef<HTMLElement> | undefined,
    section: OrderSection
  ): void {
    this.activeOrderSection.set(section);
    queueMicrotask(() => {
      ref?.nativeElement?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  }

  goHome(): void {
    this.portalView.set('home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async goToTicket(): Promise<void> {
    const ok = await this.ensureCurrentOtLoaded();
    if (!ok) return;

    this.portalView.set('order');
    this.activeOrderSection.set('presupuesto');

    queueMicrotask(() => {
      this.orderTopRef?.nativeElement?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
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
    this.activeOrderSection.set('presupuesto');
  }

  handleProcessNotification(item: ProcessNotificationItem): void {
    switch (item.kind) {
      case 'presupuesto':
        this.goToBudget();
        break;
      case 'cita':
        this.goToCita();
        break;
      case 'pago':
        this.goToPago();
        break;
      case 'chat':
        this.goToChat();
        break;
      case 'estado':
        this.goToTicket();
        break;
      case 'pending-ticket':
      default:
        this.portalView.set('success');
        break;
    }
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
      setTimeout(() => this.detailFade.set(false), 260);
    });
  }

  private resolveInitialPortalView(): void {
    if (this.pendingTicket()) return;

    if (this.ots().length > 0 || this.selectedOtDetalle()) {
      this.portalView.set('order');
      return;
    }

    this.portalView.set('home');
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

    const codigo =
      this.selectedOtCodigoSignal() ?? this.selectedOtDetalle()?.codigo ?? null;
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
      this.fastAwaitTick();
    }, 5000);

    this.fastAwaitTick();
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

  private findNewOtCodigo(before: Set<string>, after: ClienteOtItemDto[]): string | null {
    const created = after.find((o) => o?.codigo && !before.has(o.codigo));
    return created?.codigo ?? null;
  }

  private async tryDetectAndOpenNewOt(opts: {
    silent: boolean;
    quiet: boolean;
  }): Promise<boolean> {
    if (!this.pendingTicket() || !this.pendingBeforeOtCodes) return false;

    await this.loadOts({
      silent: opts.silent,
      quiet: opts.quiet,
      preserveSelection: true,
      autoLoadDetalle: false,
    });

    const newCodigo = this.findNewOtCodigo(this.pendingBeforeOtCodes, this.ots());
    if (!newCodigo) return false;

    this.selectedOtCodigoSignal.set(newCodigo);

    await this.loadDetalle(newCodigo, {
      silent: true,
      quiet: true,
      forceScroll: false,
      animate: false,
    });

    this.pendingTicket.set(null);
    this.pendingBeforeOtCodes = null;
    this.stopFastAwait();

    this.snackBar.open('Tu orden ya está disponible', undefined, {
      duration: 1800,
      panelClass: ['rs-snack-pro'],
      verticalPosition: 'bottom',
      horizontalPosition: 'center',
    });

    return true;
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

  async loadOts(opts: LoadOpts = {}): Promise<void> {
    const clienteId = this.auth.getClienteId();
    if (!clienteId) return;

    const showSpinner = !opts.silent;
    if (showSpinner) this.loading.set(true);

    try {
      const res = await this.otService.listarMisOts(0, 50);
      this.ots.set(res.items);

      const wanted = opts.preserveSelection
        ? this.selectedOtCodigoSignal() ?? this.selectedOtDetalle()?.codigo ?? null
        : this.selectedOtCodigoSignal() ?? null;

      const exists = !!wanted && res.items.some((o) => o.codigo === wanted);
      const nextCodigo = exists ? wanted : res.items[0]?.codigo ?? null;

      this.selectedOtCodigoSignal.set(nextCodigo);

      if (opts.autoLoadDetalle !== false && nextCodigo) {
        const shouldLoad =
          !this.selectedOtDetalle() || this.selectedOtDetalle()?.codigo !== nextCodigo;

        if (shouldLoad) {
          await this.loadDetalle(nextCodigo, {
            silent: true,
            quiet: opts.quiet,
            forceScroll: false,
            animate: false,
          });
        }
      }

      if (this.initialEntryResolved && !this.pendingTicket()) {
        if (this.portalView() === 'order' && !nextCodigo) {
          this.portalView.set('home');
        }
      }
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

  async loadDetalle(idOrCodigo: string, opts: LoadOpts = {}): Promise<void> {
    const showSpinner = !opts.silent;
    if (showSpinner) this.loading.set(true);

    try {
      const prevCodigo = this.selectedOtDetalle()?.codigo ?? null;
      const d = await this.otService.obtenerDetalle(idOrCodigo);

      this.selectedOtDetalle.set(d);
      if (d?.codigo) this.selectedOtCodigoSignal.set(d.codigo);

      const sameOt = !!prevCodigo && !!d?.codigo && prevCodigo === d.codigo;

      if (!opts.silent && !sameOt) {
        this.aceptoCheck.set(false);
      }

      this.requestScroll(!!opts.forceScroll);

      if (opts.animate) this.triggerFadeIn();
    } catch {
      if (!opts.quiet) {
        this.snackBar.open('No se pudo cargar el detalle del servicio', 'Cerrar', {
          duration: 2500,
          panelClass: ['rs-snack-pro'],
        });
      }
    } finally {
      if (showSpinner) this.loading.set(false);
    }
  }

  async loadTickets(opts: LoadOpts = {}): Promise<void> {
    const showSpinner = !opts.silent;
    if (showSpinner) this.loading.set(true);

    try {
      const res = await this.ticketsService.listar(0, 50);
      this.tickets.set(res.items);
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

  private openTicketDialog(data: {
    mode: 'new' | 'view';
    ticket?: TicketDetalleDto;
  }) {
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

  openNewTicket(): void {
    const beforeCodes = new Set(this.ots().map((o) => o.codigo));
    const ref = this.openTicketDialog({ mode: 'new' });

    ref.afterClosed().subscribe(async (ticket?: TicketDetalleDto) => {
      if (!ticket) return;

      this.submittedTicket.set(ticket);
      this.pendingTicket.set(ticket);
      this.pendingBeforeOtCodes = beforeCodes;
      this.portalView.set('success');

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
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }

  onPagoFileSelected(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    this.pagoFile.set(input.files?.[0] ?? null);
  }

  copyToClipboard(text: string): void {
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
    const f = this.pagoFile();
    if (!f) return;

    this.actionBusy.set(true);
    try {
      await this.otService.subirComprobantePago(otId, f);
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

  async sendMsgOt(otId: string): Promise<void> {
    const contenido = (this.msgForm.value.contenido ?? '').trim();
    if (!contenido) return;

    this.actionBusy.set(true);
    try {
      await this.otService.enviarMensaje(otId, contenido);
      this.msgForm.reset();
      await this.loadDetalle(otId, {
        forceScroll: true,
        animate: false,
      });
      this.activeOrderSection.set('chat');
      setTimeout(() => this.chatInput?.nativeElement?.focus(), 120);
    } catch {
      this.snackBar.open('Error al enviar mensaje', 'Cerrar', {
        duration: 2500,
        panelClass: ['rs-snack-pro'],
      });
    } finally {
      this.actionBusy.set(false);
    }
  }
}