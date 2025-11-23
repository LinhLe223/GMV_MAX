
import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from '../../services/data.service';
import { AuthService } from '../../services/auth.service';
import { FinancialsService } from '../../services/financials.service';

@Component({
  selector: 'app-file-uploader',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './file-uploader.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileUploaderComponent {
  dataService = inject(DataService);
  authService = inject(AuthService);
  financialsService = inject(FinancialsService);
  isLoading = signal(false);
  dragOver = signal(false);

  onFileChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      this.handleFile(target.files[0]);
    }
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      this.handleFile(event.dataTransfer.files[0]);
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
  }

  private async handleFile(file: File): Promise<void> {
    if (!this.authService.canUploadFile()) {
        this.dataService.setError("Bạn đã hết lượt tải file trong ngày. Vui lòng nâng cấp VIP hoặc liên hệ admin.");
        return;
    }

    if (!file.type.match(/csv|sheet/) && !file.name.endsWith('.xlsx') && !file.name.endsWith('.csv') && !file.name.endsWith('.xls')) {
        this.dataService.setError("Định dạng file không hợp lệ. Vui lòng tải lên file CSV hoặc Excel.");
        return;
    }
    
    this.isLoading.set(true);
    this.dataService.setError(null);

    try {
      await this.financialsService.processAndLoadAdsFile(file);
      this.authService.incrementFileUploadCount();
    } catch (error) {
      console.error(error);
      // The error is already set in dataService by the financialsService, so no need to set it again.
    } finally {
      this.isLoading.set(false);
    }
  }
}
