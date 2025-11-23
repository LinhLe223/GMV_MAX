

import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from '../../services/data.service';
import { FinancialsService } from '../../services/financials.service';

@Component({
  selector: 'app-uploader-hub',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './uploader-hub.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UploaderHubComponent {
  dataService = inject(DataService);
  financialsService = inject(FinancialsService);

  adsFile = signal<File | null>(null);
  orderFile = signal<File | null>(null);
  inventoryFile = signal<File | null>(null);
  
  error = signal<string | null>(null);
  isLoading = signal(false);
  
  errorDetails = this.financialsService.debugInfo;

  unmappedKocsString = computed(() => {
    return this.financialsService.unmappedKocs().map(k => k.name).join(', ');
  });
  
  notFoundSkusString = computed(() => {
    return this.financialsService.notFoundSkus().join(', ');
  });

  handleFile(type: 'ads' | 'order' | 'inventory', file: File | null) {
    this.error.set(null);
    this.financialsService.debugInfo.set(null);
    this.financialsService.pnlDebugStats.set(null);
    this.financialsService.notFoundSkus.set([]);
    if (!file) {
      if (type === 'ads') this.adsFile.set(null);
      if (type === 'order') this.orderFile.set(null);
      if (type === 'inventory') this.inventoryFile.set(null);
      return;
    }

    if (type === 'ads') this.adsFile.set(file);
    if (type === 'order') {
       if (file.name.includes('creator_order_all')) {
          this.orderFile.set(file);
      } else {
          this.error.set("File Đơn hàng phải có tên chứa 'creator_order_all'.");
          this.orderFile.set(null);
      }
    }
    if (type === 'inventory') {
      if (file.name.includes('Danh_sách_tồn_kho')) {
          this.inventoryFile.set(file);
      } else {
          this.error.set("File Tồn kho phải có tên chứa 'Danh_sách_tồn_kho'.");
          this.inventoryFile.set(null);
      }
    }
  }
  
  async processFiles() {
    this.isLoading.set(true);
    this.error.set(null);
    this.financialsService.reset(); // Reset all financials state including debug info

    const ads = this.adsFile();
    const order = this.orderFile();
    const inventory = this.inventoryFile();

    try {
      if (!ads) {
        throw new Error("Vui lòng tải lên file Quảng cáo (bắt buộc).");
      }
      
      await this.financialsService.processAndLoadAdsFile(ads);

      if (order && inventory) {
        await this.financialsService.processPnlFiles(order, inventory);
      }

    } catch (e) {
      this.error.set((e as Error).message);
      this.dataService.reset();
      // Financials service is already reset internally on error, but we do it again to be safe
      this.financialsService.reset();
    } finally {
      this.isLoading.set(false);
    }
  }
  
  downloadSample(type: 'ads' | 'order' | 'inventory') {
    let content = '';
    let fileName = '';
    
    if (type === 'ads') {
      fileName = 'sample_ads.csv';
      const headers = ['Tên chiến dịch','ID sản phẩm','Tiêu đề video','ID video','Tài khoản TikTok','Loại nội dung sáng tạo','Chi phí','Doanh thu gộp','ROI','Số lượt hiển thị','Số lượt nhấp','CTR','CVR','Đơn hàng (SKU)'];
      content = headers.join(',') + '\n';
      content += 'Campaign Alpha,P001,Video Title 1,V001,koc_alpha,Video,500000,2500000,5.0,10000,500,0.05,0.1,10\n';
      content += 'Campaign Beta,P002,Video Title 2,V002,koc_beta,Video,1200000,4800000,4.0,25000,800,0.032,0.08,25\n';
    } else if (type === 'order') {
      fileName = 'sample_creator_order_all.csv';
      const headers = ['ID đơn hàng','Tên người dùng nhà sáng tạo','Sku người bán','Payment Amount','Trạng thái đơn hàng','Trả hàng & hoàn tiền','Thanh toán hoa hồng thực tế','Số lượng'];
      content = headers.join(',') + '\n';
      content += 'O1,koc_alpha,SKU001,150000,đã hoàn thành,,15000,1\n';
      content += 'O2,Koc_Beta,SKU002,200000,đã hoàn thành,,20000,1\n';
      content += 'O3,koc_alpha,SKU003,đã hủy,,0,1\n';
    } else { // inventory
      fileName = 'sample_Danh_sách_tồn_kho.csv';
      const headers = ['Mã SKU','Số lượng tồn kho','Giá vốn'];
      content = headers.join(',') + '\n';
      content += 'SKU001,100,50000\n';
      content += 'SKU002,50,80000\n';
      content += 'SKU003,200,30000\n';
    }

    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", fileName);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }
}