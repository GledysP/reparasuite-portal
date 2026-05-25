import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';

import { AuthService } from '../../core/auth.service';
import { OtService } from '../../core/ot.service';
import { TicketsService } from '../../core/tickets.service';
import { decodeJwt } from '../../core/jwt';
import { ClienteOtItemDto, TicketListaItemDto } from '../../core/models';
import { TicketDialogComponent } from '../portal/ticket-dialog/ticket-dialog.component';
import { MatProgressBarModule } from '@angular/material/progress-bar';

@Component({
  selector: 'app-portal-home',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatDialogModule, MatProgressBarModule],
  templateUrl: './portal-home.component.html',
  styleUrls: ['./portal-home.component.scss']
})
export class PortalHomeComponent implements OnInit, OnDestroy {
  private auth = inject(AuthService);
  private otService = inject(OtService);
  private ticketsService = inject(TicketsService);
  private dialog = inject(MatDialog);
  private router = inject(Router);

  // Estado reactivo (Signals Angular 19)
  userDisplayName = signal('Cliente');
  latestOt = signal<ClienteOtItemDto | null>(null);
  pendingTicket = signal<TicketListaItemDto | null>(null);
  
  // Control del ciclo de recarga
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private isPolling = false;

  readonly firstName = computed(() => {
    const raw = (this.userDisplayName() || 'Cliente').trim();
    return raw.split(/\s+/)[0] || 'Cliente';
  });

  readonly welcomeWord = computed(() => {
    const n = this.firstName().toLowerCase();
    const probableFemale = ['a', 'ia', 'na', 'ela', 'ina', 'ana', 'iana', 'briana', 'maria', 'gabriela', 'valeria', 'sofia', 'camila', 'paula', 'laura'];
    return probableFemale.some((item) => n.endsWith(item)) ? 'Bienvenida' : 'Bienvenido';
  });

  ngOnInit(): void {
    this.userDisplayName.set(this.resolveUserDisplayName());
    this.loadDashboardData();

    // Auto-recarga cada 15 segundos para detectar cuando el taller crea la orden
    this.pollHandle = setInterval(() => {
      this.loadDashboardData();
    }, 15000);
  }

  ngOnDestroy(): void {
    // Evita fugas de memoria al cambiar de pantalla
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
    }
  }

  async loadDashboardData() {
    if (this.isPolling) return;
    this.isPolling = true;

    try {
      // 1. Buscamos órdenes activas
      const otRes = await this.otService.listarMisOts(0, 1);
      const activeOt = otRes.items.length > 0 ? otRes.items[0] : null;
      this.latestOt.set(activeOt);

      // 2. Si NO hay orden activa, buscamos si hay tickets en espera
      if (!activeOt) {
        const ticketRes = await this.ticketsService.listar(0, 1);
        const activeTickets = ticketRes.items.filter(t => t.estado !== 'CERRADO' && t.estado !== 'CONVERTIDO');
        this.pendingTicket.set(activeTickets.length > 0 ? activeTickets[0] : null);
      } else {
        this.pendingTicket.set(null); // Si ya hay orden, no mostramos ticket pendiente
      }
    } catch (e) {
      console.error('Error sincronizando el dashboard', e);
    } finally {
      this.isPolling = false;
    }
  }

  crearSolicitud() {
    const ref = this.dialog.open(TicketDialogComponent, {
      data: { mode: 'new' },
      width: 'min(760px, 96vw)',
      maxWidth: '96vw',
      height: 'min(860px, 92dvh)',
      maxHeight: '92dvh',
      autoFocus: false,
      restoreFocus: false,
      panelClass: ['rs-ticket-dialog', 'rs-ticket-dialog-panel'],
    });

    ref.afterClosed().subscribe((ticket) => {
      if (ticket) {
        // Redirigimos al éxito. Al volver al Home, el ngOninit volverá a cargar los datos.
        this.router.navigate(['/portal/exito']);
      }
    });
  }

  retomarOrden() {
    const ot = this.latestOt();
    if (ot) {
      this.router.navigate(['/portal/orden', ot.codigo]);
    }
  }

  private resolveUserDisplayName(): string {
    const token = this.auth.token();
    if (!token) return 'Cliente';
    const payload = decodeJwt(token) as any;
    return payload.nombre?.trim() || payload.usuario?.trim() || payload.email?.split('@')[0] || 'Cliente';
  }
}