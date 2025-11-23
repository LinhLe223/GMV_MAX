
import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as XLSX from 'xlsx';
import { DataService } from '../../services/data.service';
import { TiktokAd } from '../../models/tiktok-ad.model';
import { AuthService } from '../../services/auth.service';

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

  private handleFile(file: File): void {
    if (!this.authService.canUploadFile()) {
        this.dataService.setError("Bạn đã hết lượt tải file trong ngày. Vui lòng nâng cấp VIP hoặc liên hệ admin.");
        return;
    }

    if (!file.type.match(/csv|sheet/)) {
        this.dataService.setError("Định dạng file không hợp lệ. Vui lòng tải lên file CSV hoặc Excel.");
        return;
    }

    this.isLoading.set(true);
    const reader = new FileReader();
    reader.onload = (e: any) => {
      try {
        const bstr: string = e.target.result;
        const wb: XLSX.WorkBook = XLSX.read(bstr, { type: 'binary' });
        const wsname: string = wb.SheetNames[0];
        const ws: XLSX.WorkSheet = wb.Sheets[wsname];
        const rawData: any[] = XLSX.utils.sheet_to_json(ws, { raw: false });
        const parsedData = this.parseData(rawData);
        if (parsedData.length === 0) {
            this.dataService.setError("File không có dữ liệu hoặc không đúng cấu trúc cột.");
        } else {
            this.dataService.loadData(parsedData, file.name);
            this.authService.incrementFileUploadCount();
        }
      } catch (error) {
          console.error(error);
          this.dataService.setError("Đã xảy ra lỗi khi đọc file. Vui lòng kiểm tra lại định dạng.");
      } finally {
          this.isLoading.set(false);
      }
    };
    reader.readAsBinaryString(file);
  }

  private parseData(rawData: any[]): TiktokAd[] {
    return rawData.map(row => {
        // Create a map of lowercase_trimmed_key -> original_key for robust matching
        const keyMap: { [key: string]: string } = {};
        for (const key in row) {
            keyMap[key.toLowerCase().trim()] = key;
        }

        // Helper to get value using multiple potential keys, case-insensitively
        const getValue = (potentialKeys: string[]): any => {
            for (const pKey of potentialKeys) {
                const mappedKey = keyMap[pKey.toLowerCase().trim()];
                if (mappedKey && row[mappedKey] != null && row[mappedKey] !== '') {
                    return row[mappedKey];
                }
            }
            return undefined;
        };

        const cost = this.parseNumber(getValue(['Chi phí']));
        const gmv = this.parseNumber(getValue(['Doanh thu gộp']));
        const clicks = this.parseNumber(getValue(['Số lượt nhấp vào quảng cáo sản phẩm', 'Số lượt nhấp']));
        const impressions = this.parseNumber(getValue(['Số lượt hiển thị quảng cáo sản phẩm', 'Số lượt hiển thị']));
        const orders = this.parseNumber(getValue(['Đơn hàng (SKU)']));
        
        const campaignNameVal = getValue(['Tên chiến dịch', 'Chiến dịch']);
        const productIdVal = getValue(['ID sản phẩm']);
        const videoTitleVal = getValue(['Tiêu đề video']);
        const videoIdVal = getValue(['ID video']);
        let tiktokAccountVal = getValue(['Tài khoản TikTok']);
        const creativeTypeVal = getValue(['Loại nội dung sáng tạo']);
        
        if (!tiktokAccountVal || String(tiktokAccountVal).trim() === '-' || String(tiktokAccountVal).trim().toLowerCase() === 'không khả dụng') {
            tiktokAccountVal = 'Unknown';
        }

        const roiVal = this.parseNumber(getValue(['ROI']));
        const ctrVal = this.parseNumber(getValue(['Tỷ lệ nhấp vào quảng cáo sản phẩm', 'CTR']));
        const cvrVal = this.parseNumber(getValue(['Tỷ lệ chuyển đổi quảng cáo', 'CVR']));
        const costPerOrderVal = this.parseNumber(getValue(['Chi phí cho mỗi đơn hàng', 'CPĐH']));
        
        const cir = gmv > 0 ? (cost / gmv) * 100 : 0;
        const cpc = clicks > 0 ? cost / clicks : 0;
        const costPerOrder = costPerOrderVal || (orders > 0 ? cost / orders : 0);

        return {
            campaignName: String(campaignNameVal || 'N/A'),
            productId: String(productIdVal || 'N/A'),
            videoTitle: String(videoTitleVal || 'N/A'),
            videoId: String(videoIdVal || 'N/A'),
            tiktokAccount: String(tiktokAccountVal),
            creativeType: String(creativeTypeVal || 'N/A'),
            cost: cost,
            gmv: gmv,
            roi: roiVal,
            impressions: impressions,
            clicks: clicks,
            ctr: ctrVal,
            cvr: cvrVal,
            orders: orders,
            costPerOrder: costPerOrder,
            videoViewRate2s: this.parseNumber(getValue(['Tỷ lệ xem video quảng cáo trong 2 giây'])),
            videoViewRate6s: this.parseNumber(getValue(['Tỷ lệ xem video quảng cáo trong 6 giây'])),
            videoViewRate25p: this.parseNumber(getValue(['Tỷ lệ xem 25% thời lượng video quảng cáo'])),
            videoViewRate50p: this.parseNumber(getValue(['Tỷ lệ xem 50% thời lượng video quảng cáo'])),
            videoViewRate75p: this.parseNumber(getValue(['Tỷ lệ xem 75% thời lượng video quảng cáo'])),
            videoViewRate100p: this.parseNumber(getValue(['Tỷ lệ xem 100% thời lượng video quảng cáo'])),
            cir: cir,
            cpc: cpc
        };
    }); // Removed aggressive filtering to allow data service to handle segmentation
  }

  private parseNumber(value: any): number {
    if (value == null || value === '' || value === '-') {
        return 0;
    }
    if (typeof value === 'number') {
        return value;
    }

    let strValue = String(value).trim().replace(/đ|₫|VND|%|\s/gi, '');
    if (!strValue) return 0;

    const hasComma = strValue.includes(',');
    const hasDot = strValue.includes('.');

    // Handle mixed separators: the last separator is treated as the decimal separator.
    if (hasComma && hasDot) {
        if (strValue.lastIndexOf(',') > strValue.lastIndexOf('.')) {
            // Format is "1.234,56" -> dot is thousand, comma is decimal
            strValue = strValue.replace(/\./g, '').replace(',', '.');
        } else {
            // Format is "1,234.56" -> comma is thousand, dot is decimal
            strValue = strValue.replace(/,/g, '');
        }
    } 
    // Handle numbers with only commas
    else if (hasComma) {
        const parts = strValue.split(',');
        // If there are multiple commas, or if the part after a single comma has 3 digits,
        // it's a thousands separator (e.g., "1,234,567" or "1,234").
        if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
            strValue = strValue.replace(/,/g, '');
        } else {
            // Otherwise, it's a decimal separator (e.g., "1,23").
            strValue = strValue.replace(',', '.');
        }
    } 
    // Handle numbers with only dots
    else if (hasDot) {
        const parts = strValue.split('.');
         // If there are multiple dots, or if the part after a single dot has 3 digits,
        // it's a thousands separator (e.g., "1.234.567" or "1.234" which is common in Vietnam).
        if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
            strValue = strValue.replace(/\./g, '');
        }
        // Otherwise, it's a decimal dot (e.g., "1.23"), so no change is needed.
    }

    const num = parseFloat(strValue);
    return isNaN(num) ? 0 : num;
  }
}
