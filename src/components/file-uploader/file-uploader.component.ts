
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
  financialsService = inject(FinancialsService); // Inject Service
  
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
        this.dataService.setError("Bạn đã hết lượt tải file trong ngày.");
        return;
    }

    if (!file.name.match(/\.(csv|xlsx|xls)$/i)) {
        this.dataService.setError("Định dạng file không hợp lệ. Vui lòng tải file Excel/CSV.");
        return;
    }

    this.isLoading.set(true);
    
    try {
      // GỌI SERVICE ĐỂ XỬ LÝ FILE THÔNG MINH (TỰ TÌM HEADER)
      await this.financialsService.processAndLoadAdsFile(file);
      this.authService.incrementFileUploadCount();
    } catch (error) {
      console.error(error);
      // Lỗi đã được hiển thị trong Service
    } finally {
      this.isLoading.set(false);
    }
  }
}
