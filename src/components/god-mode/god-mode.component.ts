import { Component, ChangeDetectionStrategy, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FinancialsService } from '../../services/financials.service';
import { KocPnlData, EnrichedOrderData, KocDetailItem, ProductPnlData } from '../../models/financial.model';
import { PaginationComponent } from '../pagination/pagination.component';
import { DataService } from '../../services/data.service';
import { TiktokAd } from '../../models/tiktok-ad.model';

type DetailSortKey = keyof KocDetailItem;


@Component({
  selector: 'app-god-mode',
  standalone: true,
  imports: [CommonModule, PaginationComponent],
  templateUrl: './god-mode.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GodModeComponent {
  financialsService = inject(FinancialsService);
  dataService = inject(DataService);
  dashboardMetrics = this.financialsService.dashboardMetrics;
  
  // --- View State ---
  selectedKoc = signal<KocPnlData | null>(null);
  viewMode = signal<'koc' | 'product'>('koc');
  copiedVideoId = signal<string | null>(null);

  // --- Sorting & Pagination State ---
  sortKey = signal<string>('netProfit');
  sortDirection = signal<'asc' | 'desc'>('desc');
  currentPage = signal(1);
  itemsPerPage = signal(20);
  
  // --- Data ---
  kocData = this.financialsService.kocPnlData;
  productData = this.financialsService.productPnlData;

  sortedData = computed(() => {
    const data = this.viewMode() === 'koc' ? this.kocData() : this.productData();
    const key = this.sortKey();
    const dir = this.sortDirection() === 'asc' ? 1 : -1;

    type DataItem = KocPnlData | ProductPnlData;

    return [...data].sort((a: DataItem, b: DataItem) => {
      const valA = (a as any)[key] ?? 0;
      const valB = (b as any)[key] ?? 0;
      
      if (typeof valA === 'string' && typeof valB === 'string') {
        return valA.localeCompare(valB) * dir;
      }
      if (valA < valB) return -1 * dir;
      if (valA > valB) return 1 * dir;
      return 0;
    });
  });

  paginatedData = computed(() => {
    const data = this.sortedData();
    const page = this.currentPage();
    const perPage = this.itemsPerPage();

    if (perPage >= data.length) {
      return data;
    }
    const start = (page - 1) * perPage;
    const end = start + perPage;
    return data.slice(start, end);
  });
  
  // --- Drill-Down View State ---
  detailSortKey = signal<DetailSortKey>('revenue');
  detailSortDirection = signal<'asc' | 'desc'>('desc');

  // --- Drill-Down View Data ---
  selectedKocOrders = computed(() => {
    const koc = this.selectedKoc();
    if (!koc) return [];
    return this.financialsService.ordersWithCogsByKoc().get(koc.normalizedKocName) || [];
  });

  kocDetails = computed<KocDetailItem[]>(() => {
    const orders = this.selectedKocOrders();
    const koc = this.selectedKoc();
    if (orders.length === 0 || !koc) return [];

    const kocAds = this.dataService.kocReportStats().find(k => k.name.toLowerCase().trim() === koc.kocName.toLowerCase().trim());
    const adsByVideoId = new Map<string, TiktokAd>(kocAds?.videos.map(v => [v.videoId, v]) || []);

    const detailsByVideo = new Map<string, {
        revenue: number;
        returnCount: number;
        commission: number;
        productName: string;
        productId: string;
    }>();

    for (const order of orders) {
      const videoId = order.videoId || 'no-video';
      if (!detailsByVideo.has(videoId)) {
        detailsByVideo.set(videoId, {
          revenue: 0,
          returnCount: 0,
          commission: 0,
          productName: order.product_name,
          productId: order.product_id,
        });
      }

      const detail = detailsByVideo.get(videoId)!;
      const isFailed = this.isFailedOrder(order);
      if (!isFailed) {
          detail.revenue += order.revenue;
          detail.commission += order.commission;
      } else {
          detail.returnCount++;
      }
    }
    
    const result: KocDetailItem[] = [];
    for (const [videoId, data] of detailsByVideo.entries()) {
        const adData = adsByVideoId.get(videoId);
        const cost = adData?.cost || 0;
        const roi = cost > 0 ? data.revenue / cost : 0;
        const cir = data.revenue > 0 ? (cost / data.revenue) * 100 : 0;
        
        result.push({
            videoId: videoId,
            videoName: adData?.videoTitle || 'N/A',
            productName: data.productName,
            productId: data.productId,
            revenue: data.revenue,
            cost: cost,
            returnCount: data.returnCount,
            commission: data.commission,
            roi: roi,
            cir: cir,
        });
    }
    return result;
  });

  sortedKocDetails = computed(() => {
    const data = this.kocDetails();
    const key = this.detailSortKey();
    const dir = this.detailSortDirection() === 'asc' ? 1 : -1;

    return [...data].sort((a, b) => {
      const valA = a[key];
      const valB = b[key];
      if (typeof valA === 'string' && typeof valB === 'string') {
        return valA.localeCompare(valB) * dir;
      }
      if (valA < valB) return -1 * dir;
      if (valA > valB) return 1 * dir;
      return 0;
    });
  });

  // --- Event Handlers & Helpers ---
  selectKoc(koc: KocPnlData): void {
    this.selectedKoc.set(this.selectedKoc() === koc ? null : koc);
  }

  onSort(key: string): void {
    if (this.sortKey() === key) {
      this.sortDirection.update(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortKey.set(key);
      this.sortDirection.set('desc');
    }
    this.currentPage.set(1);
  }

  onPageChange(page: number): void { this.currentPage.set(page); }
  onItemsPerPageChange(perPage: number): void {
    this.itemsPerPage.set(perPage);
    this.currentPage.set(1);
  }
  
  onDetailSort(key: DetailSortKey): void {
    if (this.detailSortKey() === key) {
      this.detailSortDirection.update(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      this.detailSortKey.set(key);
      this.detailSortDirection.set('desc');
    }
  }

  copyToClipboard(text: string) {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      this.copiedVideoId.set(text);
      setTimeout(() => this.copiedVideoId.set(null), 2000);
    }).catch(err => console.error('Failed to copy ID: ', err));
  }
  
  getTikTokVideoLink(username: string, videoId: string): string {
    if (!username || !videoId || videoId === 'no-video') return '#';
    const cleanUser = username.replace('@', '').trim();
    return `https://www.tiktok.com/@${cleanUser}/video/${videoId}`;
  }
  
  getKocInsight(koc: KocPnlData): { tag: string, color: string } {
    if (koc.netProfit > 500000 && (koc.returnCancelPercent < 20 || koc.returnCancelPercent === 0)) {
        return { tag: '🔥 VÍT MẠNH', color: 'bg-green-100 text-green-800' };
    }
    if (koc.netProfit < 0 && koc.adsCost > 2000000) {
        return { tag: '✂️ CẮT LỖ', color: 'bg-red-100 text-red-800' };
    }
    if (koc.returnCancelPercent > 50) {
        return { tag: '⚠️ HOÀN CAO', color: 'bg-yellow-100 text-yellow-800' };
    }
    if (koc.adsCost > 500000 && koc.nmv === 0) {
        return { tag: '🚫 KHÔNG RA SỐ', color: 'bg-red-100 text-red-800' };
    }
    return { tag: '➖ Ổn định', color: 'bg-gray-100 text-gray-800' };
  }
  
  isFailedOrder(order: EnrichedOrderData): boolean {
    const status = (order.status || '').toLowerCase();
    const failedStatus = ['đã hủy', 'đã đóng', 'thất bại'];
    const refundKeywords = ['hoàn tiền'];
    return failedStatus.some(s => status.includes(s)) || refundKeywords.some(kw => status.includes(kw));
  }
}