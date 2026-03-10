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
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';

import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatTabsModule } from '@angular/material/tabs';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatMenuModule } from '@angular/material/menu';
import { MatBadgeModule } from '@angular/material/badge';
import { MatFormFieldModule } from '@angular/material/form-field';

import { environment } from '../../../environments/environment';
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

type LoadOpts = {
  silent?: boolean;
  quiet?: boolean;
  preserveSelection?: boolean;
  autoLoadDetalle?: boolean;
  forceScroll?: boolean;
  animate?: boolean;
  autoNavTabs?: boolean;
};

type ProcessNotificationKind =
  | 'pending-ticket'
  | 'presupuesto'
  | 'cita'
  | 'pago'
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
    MatCardModule,
    MatProgressBarModule,
    MatSnackBarModule,
    MatDialogModule,
    MatCheckboxModule,
    MatTabsModule,
    MatSelectModule,
    MatTooltipModule,
    MatExpansionModule,
    MatMenuModule,
    MatBadgeModule,
    MatFormFieldModule,
  ],
  templateUrl: './portal.component.html',
  styleUrls: ['./portal.component.scss'],
})
export class PortalComponent implements OnInit, OnDestroy, AfterViewChecked {
  @ViewChild('chatScroll') private chatContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('chatCardRef') private chatCardRef?: ElementRef<HTMLElement>;
  @ViewChild('gestionCardTop') private gestionCardRef?: ElementRef<HTMLElement>;
  @ViewChild('statusStripRef') private statusStripRef?: ElementRef<HTMLElement>;
  @ViewChild('chatInput') private chatInput?: ElementRef<HTMLInputElement>;

  apiBase = environment.apiBaseUrl;

  private fb = inject(FormBuilder);
  private snackBar = inject(MatSnackBar);

  loading = signal(false);
  actionBusy = signal(false);

  ots = signal<ClienteOtItemDto[]>([]);
  tickets = signal<TicketListaItemDto[]>([]);
  selectedOtDetalle = signal<OtDetalleDto | null>(null);

  selectedOtCodigoSignal = signal<string | null>(null);
  aceptoCheck = signal(false);
  pagoFile = signal<File | null>(null);
  gestionTabIndex = signal(0);
  detailFade = signal(false);

  pendingTicket = signal<TicketDetalleDto | null>(null);
  private pendingBeforeOtCodes: Set<string> | null = null;

  lastPortalSyncAt = signal<number | null>(null);
  nowTick = signal(Date.now());

  msgForm = this.fb.group({
    contenido: ['', [Validators.required, Validators.minLength(1)]],
  });

  readonly steps: { key: StepKey; label: string; icon: string }[] = [
    { key: 'RECIBIDA', label: 'Recibida', icon: 'inventory_2' },
    { key: 'PRESUPUESTO', label: 'Presupuesto', icon: 'request_quote' },
    { key: 'APROBADA', label: 'Aprobada', icon: 'verified' },
    { key: 'EN_CURSO', label: 'En curso', icon: 'build' },
    { key: 'FINALIZADA', label: 'Finalizada', icon: 'task_alt' },
  ];

  readonly welcomeSteps = [
    {
      icon: 'edit_square',
      title: 'Envía tu solicitud',
      desc: 'Crea el ticket en segundos.',
    },
    {
      icon: 'engineering',
      title: 'El taller la valida',
      desc: 'Acepta la solicitud y crea la orden.',
    },
    {
      icon: 'track_changes',
      title: 'Sigue todo en tiempo real',
      desc: 'Presupuesto, citas, pago y mensajes.',
    },
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
  private clockHandle: ReturnType<typeof setInterval> | null = null;
  private fastAwaitUntil = 0;

  private detailInFlight = false;
  private listInFlight = false;

  private visibilityHandler = () => {
    if (document.visibilityState === 'visible') {
      this.silentWarmRefresh();
    }
  };

  constructor(
    private auth: AuthService,
    private otService: OtService,
    private ticketsService: TicketsService,
    private router: Router,
    private dialog: MatDialog
  ) {
    this.refreshAll();
  }

  ngOnInit(): void {
    this.detailPollHandle = setInterval(() => {
      this.pollDetailTick();
    }, 8000);

    this.listPollHandle = setInterval(() => {
      this.pollListTick();
    }, 25000);

    this.clockHandle = setInterval(() => {
      this.nowTick.set(Date.now());
    }, 30000);

    document.addEventListener('visibilitychange', this.visibilityHandler);
  }

  ngOnDestroy(): void {
    if (this.detailPollHandle) clearInterval(this.detailPollHandle);
    if (this.listPollHandle) clearInterval(this.listPollHandle);
    if (this.fastAwaitHandle) clearInterval(this.fastAwaitHandle);
    if (this.clockHandle) clearInterval(this.clockHandle);

    this.detailPollHandle = null;
    this.listPollHandle = null;
    this.fastAwaitHandle = null;
    this.clockHandle = null;

    document.removeEventListener('visibilitychange', this.visibilityHandler);
  }

  private markSynced(): void {
    const now = Date.now();
    this.lastPortalSyncAt.set(now);
    this.nowTick.set(now);
  }

  humanizedSyncLabel = computed(() => {
    const ts = this.lastPortalSyncAt();
    const now = this.nowTick();

    if (!ts) return 'Sincronizando…';

    const diff = Math.max(0, now - ts);

    if (diff < 15000) return 'Actualizado ahora';

    if (diff < 60000) {
      const secs = Math.max(1, Math.floor(diff / 1000));
      return `Actualizado hace ${secs} s`;
    }

    if (diff < 3600000) {
      const mins = Math.floor(diff / 60000);
      return `Actualizado hace ${mins} min`;
    }

    const hours = Math.floor(diff / 3600000);
    return `Actualizado hace ${hours} h`;
  });

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

    const today = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    ).getTime();
    const target = new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate()
    ).getTime();
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

    if (
      ['NUEVA', 'RECIBIDA', 'RECIBIDO', 'CREADA', 'REGISTRADA'].includes(e)
    ) {
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
      [
        'EN_CURSO',
        'REPARANDO',
        'EN_REPARACION',
        'REPARACION',
        'EN_PROCESO',
      ].includes(e) ||
      e.includes('CURSO') ||
      e.includes('REPAR')
    ) {
      return 'EN_CURSO';
    }

    if (
      [
        'FINALIZADA',
        'LISTO',
        'TERMINADA',
        'FINALIZADO',
        'ENTREGADA',
        'ENTREGADO',
      ].includes(e) ||
      e.includes('FINAL') ||
      e.includes('TERMIN') ||
      e.includes('LIST')
    ) {
      return 'FINALIZADA';
    }

    return 'RECIBIDA';
  }

  selectedOtListItem = computed<ClienteOtItemDto | null>(() => {
    const codigo = this.selectedOtCodigoSignal();
    if (!codigo) return null;
    return this.ots().find((o) => o.codigo === codigo) ?? null;
  });

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
      this.stepRank[resolved] < this.stepRank['APROBADA']
    ) {
      resolved = 'APROBADA';
    }

    return resolved;
  }

  stepKey = computed<StepKey>(() =>
    this.resolveBusinessStep(this.selectedOtDetalle(), this.selectedOtListItem())
  );

  stepIndex = computed(() => this.stepRank[this.stepKey()]);
  currentStepLabel = computed(
    () => this.steps[this.stepIndex()]?.label ?? 'Recibida'
  );

  nextCita = computed<CitaDto | null>(() => {
    const ot = this.selectedOtDetalle();
    const citas = ot?.citas ?? [];
    if (!citas.length) return null;

    const sorted = [...citas].sort(
      (a, b) => this.toMillis(a.inicio) - this.toMillis(b.inicio)
    );
    return sorted[0] ?? null;
  });

  visibleTickets = computed<TicketListaItemDto[]>(() =>
    this.tickets().slice(0, 2)
  );
  hiddenTicketCount = computed<number>(() =>
    Math.max(0, this.tickets().length - 2)
  );

  quickUnreadCount = computed<number>(() => {
    const msgs = this.selectedOtDetalle()?.mensajes ?? [];
    return msgs.filter((m) => !this.isClienteMsg(m)).length;
  });

  quickHasPendingPago = computed<boolean>(() => {
    const ot = this.selectedOtDetalle() as any;
    if (!ot) return false;

    const presupuestoEstado = this.normalizeStatus(ot.presupuesto?.estado);
    const pagoEstado = this.normalizeStatus(ot.pago?.estado);

    const presupuestoListo = [
      'APROBADA',
      'ACEPTADO',
      'APROBADO',
      'ACEPTADA',
    ].includes(presupuestoEstado);
    const pagoPendiente = ![
      'CONFIRMADO',
      'VALIDADO',
      'PAGADO',
      'COMPLETADO',
    ].includes(pagoEstado);

    return presupuestoListo && pagoPendiente;
  });

  messageMenuItems = computed<MensajeDto[]>(() => {
    const ot = this.selectedOtDetalle();
    return [...(ot?.mensajes ?? [])]
      .filter((m) => !this.isClienteMsg(m))
      .sort((a, b) => this.toMillis(b.createdAt) - this.toMillis(a.createdAt))
      .slice(0, 4);
  });

  unreadMessageCount = computed<number>(() => this.quickUnreadCount());

  processNotifications = computed<ProcessNotificationItem[]>(() => {
    const items: ProcessNotificationItem[] = [];
    const ot = this.selectedOtDetalle();

    if (!ot && this.pendingTicket()) {
      items.push({
        kind: 'pending-ticket',
        icon: 'schedule',
        title: 'Solicitud en revisión',
        subtitle: 'El taller debe aceptarla antes de crear la orden.',
      });
      return items;
    }

    if (!ot) return items;

    const presupuestoEstado = this.normalizeStatus(ot.presupuesto?.estado);

    if (['ENVIADO', 'PENDIENTE'].includes(presupuestoEstado)) {
      items.push({
        kind: 'presupuesto',
        icon: 'payments',
        title: 'Presupuesto disponible',
        subtitle: 'Revísalo desde la pestaña Presupuesto.',
      });
    }

    if (this.nextCita()) {
      items.push({
        kind: 'cita',
        icon: 'event',
        title: 'Próxima cita',
        subtitle: 'Consulta fecha y hora programadas.',
        date: this.nextCita()?.inicio ?? null,
      });
    }

    if (this.quickHasPendingPago()) {
      items.push({
        kind: 'pago',
        icon: 'account_balance',
        title: 'Pago pendiente',
        subtitle: 'Confirma la transferencia o sube el comprobante.',
      });
    }

    if (this.stepKey() === 'FINALIZADA') {
      items.push({
        kind: 'estado',
        icon: 'task_alt',
        title: 'Orden finalizada',
        subtitle: 'Tu proceso ya llegó a la última etapa.',
      });
    }

    return items;
  });

  processNotificationCount = computed<number>(
    () => this.processNotifications().length
  );

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

      const sameDayAsPrev =
        !!prev && this.sameLocalDay(prev.createdAt, message.createdAt);

      const showDayDivider = !prev || !sameDayAsPrev;
      const showMeta = !isMine && (!sameSenderAsPrev || !sameDayAsPrev);
      const showAvatar = showMeta;

      return {
        id:
          (message as any)?.id ??
          `${index}-${message.createdAt}-${message.contenido}`,
        message,
        isMine,
        showAvatar,
        showMeta,
        showDayDivider,
        dayLabel: this.getChatDayLabel(message.createdAt),
      };
    });
  });

  private scrollRequested = false;
  private scrollForce = false;

  ngAfterViewChecked() {
    if (!this.scrollRequested) return;

    if (this.scrollForce || this.isChatNearBottom(90)) {
      this.scrollToBottom();
    }

    this.scrollRequested = false;
    this.scrollForce = false;
  }

  private requestScroll(force = false) {
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
    } catch {}
  }

  private triggerFadeIn(): void {
    this.detailFade.set(false);
    queueMicrotask(() => {
      this.detailFade.set(true);
      setTimeout(() => this.detailFade.set(false), 260);
    });
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
        autoNavTabs: false,
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

  private stopFastAwait() {
    if (this.fastAwaitHandle) clearInterval(this.fastAwaitHandle);
    this.fastAwaitHandle = null;
    this.fastAwaitUntil = 0;
  }

  private startFastAwait() {
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

  private findNewOtCodigo(
    before: Set<string>,
    after: ClienteOtItemDto[]
  ): string | null {
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
      forceScroll: true,
      animate: true,
      autoNavTabs: true,
    });

    this.pendingTicket.set(null);
    this.pendingBeforeOtCodes = null;
    this.stopFastAwait();

    this.snackBar.open('✓ La orden ya está disponible', undefined, {
      duration: 1800,
      panelClass: ['rs-snack-pro'],
      verticalPosition: 'bottom',
      horizontalPosition: 'center',
    });

    return true;
  }

  trackById(index: number, item: any) {
    return item?.id ?? item?.codigo ?? item?.fecha ?? item?.createdAt ?? index;
  }

  selectedOtCodigo(): string | null {
    return this.selectedOtDetalle()?.codigo ?? null;
  }

  isClienteMsg(m: MensajeDto): boolean {
    return this.normalizeStatus(m.remitenteTipo) === 'CLIENTE';
  }

  getSenderName(m: MensajeDto): string {
    return (m.remitenteNombre || '').trim() || 'Técnico';
  }

  focusStatus() {
    queueMicrotask(() => {
      this.statusStripRef?.nativeElement?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  }

  goToGestionTab(index: number) {
    this.gestionTabIndex.set(index);
    queueMicrotask(() => {
      this.gestionCardRef?.nativeElement?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  }

  focusMessages() {
    queueMicrotask(() => {
      this.chatCardRef?.nativeElement?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
      this.requestScroll(true);
      setTimeout(() => this.chatInput?.nativeElement?.focus(), 220);
    });
  }

  handleProcessNotification(item: ProcessNotificationItem) {
    switch (item.kind) {
      case 'presupuesto':
        this.goToGestionTab(0);
        break;
      case 'cita':
        this.goToGestionTab(1);
        break;
      case 'pago':
        this.goToGestionTab(2);
        break;
      case 'estado':
        this.focusStatus();
        break;
      case 'pending-ticket':
      default:
        break;
    }
  }

  openHowItWorks(): void {
    this.snackBar.open(
      'Crea tu solicitud, espera la validación del taller y sigue cada avance desde el portal.',
      'Cerrar',
      { duration: 4200, panelClass: ['rs-snack-pro'] }
    );
  }

  async refreshAll() {
    await Promise.all([
      this.loadOts({ preserveSelection: true, autoLoadDetalle: true }),
      this.loadTickets(),
    ]);
  }

  async loadOts(opts: LoadOpts = {}) {
    const clienteId = this.auth.getClienteId();
    if (!clienteId) return;

    const showSpinner = !opts.silent;
    if (showSpinner) this.loading.set(true);

    try {
      const res = await this.otService.listarMisOts(clienteId, 0, 50);
      this.ots.set(res.items);
      this.markSynced();

      const wanted = opts.preserveSelection
        ? this.selectedOtCodigoSignal() ?? this.selectedOtDetalle()?.codigo ?? null
        : this.selectedOtCodigoSignal() ?? null;

      const exists = !!wanted && res.items.some((o) => o.codigo === wanted);
      const nextCodigo = exists ? wanted : res.items[0]?.codigo ?? null;

      this.selectedOtCodigoSignal.set(nextCodigo);

      if (opts.autoLoadDetalle !== false) {
        const shouldLoad =
          !this.selectedOtDetalle() ||
          (nextCodigo && this.selectedOtDetalle()?.codigo !== nextCodigo);

        if (shouldLoad && nextCodigo) {
          await this.loadDetalle(nextCodigo, {
            silent: true,
            quiet: opts.quiet,
            forceScroll: true,
            animate: true,
            autoNavTabs: true,
          });
        }
      }
    } catch {
      if (!opts.quiet) {
        this.snackBar.open('No se pudieron cargar las órdenes', 'Cerrar', {
          duration: 2500,
          panelClass: ['rs-snack-pro'],
        });
      }
    } finally {
      if (showSpinner) this.loading.set(false);
    }
  }

  async loadDetalle(idOrCodigo: string, opts: LoadOpts = {}) {
    const showSpinner = !opts.silent;
    if (showSpinner) this.loading.set(true);

    try {
      const prevCodigo = this.selectedOtDetalle()?.codigo ?? null;
      const d = await this.otService.obtenerDetalle(idOrCodigo);

      this.selectedOtDetalle.set(d);
      this.markSynced();

      if (d?.codigo) this.selectedOtCodigoSignal.set(d.codigo);

      const sameOt = !!prevCodigo && !!d?.codigo && prevCodigo === d.codigo;

      if (!opts.silent && !sameOt) {
        this.aceptoCheck.set(false);

        if (opts.autoNavTabs !== false && d?.citas?.length) {
          this.gestionTabIndex.set(1);
        }
      }

      this.requestScroll(!!opts.forceScroll);

      if (opts.animate) this.triggerFadeIn();
    } catch {
      if (!opts.quiet) {
        this.snackBar.open('No se pudo cargar el detalle de la OT', 'Cerrar', {
          duration: 2500,
          panelClass: ['rs-snack-pro'],
        });
      }
    } finally {
      if (showSpinner) this.loading.set(false);
    }
  }

  async loadTickets(opts: LoadOpts = {}) {
    const showSpinner = !opts.silent;
    if (showSpinner) this.loading.set(true);

    try {
      const res = await this.ticketsService.listar(0, 50);
      this.tickets.set(res.items);
      this.markSynced();
    } catch {
      if (!opts.quiet) {
        this.snackBar.open('No se pudieron cargar los tickets', 'Cerrar', {
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

  openNewTicket() {
    const beforeCodes = new Set(this.ots().map((o) => o.codigo));

    const ref = this.openTicketDialog({ mode: 'new' });

    ref.afterClosed().subscribe(async (ticket?: TicketDetalleDto) => {
      if (!ticket) return;

      this.pendingTicket.set(ticket);
      this.pendingBeforeOtCodes = beforeCodes;

      this.snackBar.open('✓ Solicitud enviada correctamente', undefined, {
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

  async openTicket(ticketId: string) {
    try {
      const detail = await this.ticketsService.obtener(ticketId);
      this.openTicketDialog({ mode: 'view', ticket: detail });
    } catch {
      this.snackBar.open('No se pudo cargar el ticket', 'Cerrar', {
        duration: 2500,
        panelClass: ['rs-snack-pro'],
      });
    }
  }

  async selectOt(ot: ClienteOtItemDto) {
    this.selectedOtCodigoSignal.set(ot.codigo);
    await this.loadDetalle(ot.codigo, {
      forceScroll: true,
      animate: true,
      autoNavTabs: true,
    });
  }

  async onOtSelectChange(codigo: string) {
    if (!codigo) return;
    this.selectedOtCodigoSignal.set(codigo);
    await this.loadDetalle(codigo, {
      forceScroll: true,
      animate: true,
      autoNavTabs: true,
    });
  }

  logout() {
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }

  onPagoFileSelected(ev: Event) {
    const input = ev.target as HTMLInputElement;
    this.pagoFile.set(input.files?.[0] ?? null);
  }

  copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      this.snackBar.open('✓ Copiado al portapapeles', undefined, {
        duration: 1400,
        panelClass: ['rs-snack-pro'],
      });
    });
  }

  async aceptar(otId: string) {
    if (!this.aceptoCheck()) return;

    this.actionBusy.set(true);
    try {
      await this.otService.aceptarPresupuesto(otId);
      await this.loadDetalle(otId, { forceScroll: false, animate: false });
      this.snackBar.open('✓ Presupuesto aceptado', undefined, {
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

  async rechazar(otId: string) {
    this.actionBusy.set(true);
    try {
      await this.otService.rechazarPresupuesto(otId);
      await this.loadDetalle(otId, { forceScroll: false, animate: false });
      this.snackBar.open('✓ Presupuesto rechazado', undefined, {
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

  async marcarTransferencia(otId: string) {
    this.actionBusy.set(true);
    try {
      await this.otService.marcarTransferencia(otId);
      await this.loadDetalle(otId, { forceScroll: false, animate: false });
      this.snackBar.open('✓ Transferencia confirmada', undefined, {
        duration: 1400,
        panelClass: ['rs-snack-pro'],
      });
    } catch {
      this.snackBar.open('Error al marcar', 'Cerrar', {
        duration: 2500,
        panelClass: ['rs-snack-pro'],
      });
    } finally {
      this.actionBusy.set(false);
    }
  }

  async uploadComprobante(otId: string) {
    const f = this.pagoFile();
    if (!f) return;

    this.actionBusy.set(true);
    try {
      await this.otService.subirComprobantePago(otId, f);
      this.pagoFile.set(null);
      await this.loadDetalle(otId, { forceScroll: false, animate: false });
      this.snackBar.open('✓ Comprobante subido', undefined, {
        duration: 1400,
        panelClass: ['rs-snack-pro'],
      });
    } catch {
      this.snackBar.open('Error al subir', 'Cerrar', {
        duration: 2500,
        panelClass: ['rs-snack-pro'],
      });
    } finally {
      this.actionBusy.set(false);
    }
  }

  async sendMsgOt(otId: string) {
    if (this.msgForm.invalid) return;

    const contenido = (this.msgForm.value.contenido ?? '').trim();
    if (!contenido) return;

    this.actionBusy.set(true);
    try {
      await this.otService.enviarMensaje(otId, contenido);
      this.msgForm.reset();
      await this.loadDetalle(otId, {
        forceScroll: true,
        animate: false,
        autoNavTabs: false,
      });
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