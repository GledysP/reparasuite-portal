import { Component, Inject, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';

import {
  MatDialogRef,
  MAT_DIALOG_DATA,
  MatDialogModule,
} from '@angular/material/dialog';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import {
  TicketsService,
  TicketCrearPayload,
} from '../../../core/tickets.service';

import { TicketDetalleDto } from '../../../core/models';

@Component({
  selector: 'app-ticket-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './ticket-dialog.component.html',
  styleUrls: ['./ticket-dialog.component.scss'],
})
export class TicketDialogComponent {
  private fb = inject(FormBuilder).nonNullable;
  private ticketsService = inject(TicketsService);
  private snack = inject(MatSnackBar);

  loading = signal(false);
  selectedFile = signal<File | null>(null);
  dragActive = signal(false);

  submitAttempted = signal(false);
  shakeTick = signal(0);

  form = this.fb.group({
    equipo: ['', [Validators.required]],
    tipoServicioSugerido: ['' as 'TIENDA' | 'DOMICILIO' | ''],
    descripcionFalla: ['', [Validators.required]],
    direccion: [''],
    observaciones: [''],
  });

  constructor(
    public dialogRef: MatDialogRef<TicketDialogComponent>,
    @Inject(MAT_DIALOG_DATA)
    public data: { mode: 'new' | 'view'; ticket?: TicketDetalleDto },
  ) {
    if (data?.mode === 'view' && data.ticket) {
      this.form.patchValue({
        equipo: (data.ticket as any).equipo ?? '',
        descripcionFalla:
          (data.ticket as any).descripcionFalla ??
          (data.ticket as any).descripcion ??
          '',
        direccion: (data.ticket as any).direccion ?? '',
        observaciones: (data.ticket as any).observaciones ?? '',
      });

      this.form.disable();
    }
  }

  isInvalid(name: keyof typeof this.form.controls) {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || this.submitAttempted());
  }

  private triggerShake() {
    this.shakeTick.update((v) => v + 1);
  }

  clearFile() {
    this.selectedFile.set(null);
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) this.selectedFile.set(input.files[0]);
  }

  onDragOver(ev: DragEvent) {
    ev.preventDefault();
    this.dragActive.set(true);
  }

  onDragLeave(ev: DragEvent) {
    ev.preventDefault();
    this.dragActive.set(false);
  }

  onDrop(ev: DragEvent) {
    ev.preventDefault();
    this.dragActive.set(false);
    const f = ev.dataTransfer?.files?.[0];
    if (f) this.selectedFile.set(f);
  }

  async crear() {
    this.submitAttempted.set(true);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.triggerShake();
      return;
    }

    this.loading.set(true);

    const raw = this.form.getRawValue();

    const payload: TicketCrearPayload = {
      asunto: `Soporte: ${raw.equipo}`,
      equipo: raw.equipo,
      descripcionFalla: raw.descripcionFalla,
      tipoServicioSugerido: raw.tipoServicioSugerido || null,
      direccion: raw.direccion || null,
      descripcion: raw.observaciones || raw.descripcionFalla,
    };

    try {
      const ticket = await this.ticketsService.crear(payload);

      if (this.selectedFile() && (ticket as any).id) {
        await this.ticketsService.subirFoto((ticket as any).id, this.selectedFile()!);
      }

      this.dialogRef.close(ticket);
    } catch {
      this.snack.open(
        'No se pudo enviar la solicitud. Intenta más tarde.',
        'Cerrar',
        { duration: 3500 }
      );
    } finally {
      this.loading.set(false);
    }
  }
}