import { Component, ChangeDetectionStrategy, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FinancialsService } from '../../services/financials.service';
import { KocPnlData, EnrichedOrderData, KocDetailItem } from '../../models/financial.model';
import { PaginationComponent } from '../pagination/pagination.component';
import { DataService } from '../../services/data.service';
// FIX: Add missing import for TiktokAd type.
import { TiktokAd } from '../../models/tiktok-ad.model';

type SortKey = 
  | 'netProfit_desc' 
  | 'netProfit_asc' 
  | 'nmv_desc'
  | 'adsGmv_desc'
  | 'returnCancelPercent_asc'
  | 'totalCommission_desc'
  | 'totalCogs_desc'
  | 'adsCost_desc';

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

  // --- Master Table State ---
  sortKey = signal<SortKey>('netProfit_desc');
  currentPage = signal(1);
  itemsPerPage = signal(20);
  
  // --- Master Table Data ---
  sortedData = computed(() => {
    const data = this.financialsService.kocPnlData();
    const key = this.sortKey();

    return [...data].sort((a, b) => {
      switch (key) {
        case 'netProfit_desc': return b.netProfit - a.netProfit;
        case 'netProfit_asc': return a.netProfit - b.netProfit;
        case 'nmv_desc': return b.nmv - a.nmv;
        case 'adsGmv_desc': return b.adsGmv - a.adsGmv;
        case 'returnCancelPercent_asc': return a.returnCancelPercent - b.returnCancelPercent;
        case 'totalCommission_desc': return b.totalCommission - a.totalCommission;
        case 'totalCogs_desc': return b.totalCogs - a.totalCogs;
        case 'adsCost_desc': return b.adsCost - a.adsCost;
        default: return 0;
      }
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
  selectedKocDetails = computed(() => {
    const koc = this.selectedKoc();
    if (!koc) return null;
    return {
      totalOrders: koc.totalOrders,
      nmv: koc.nmv,
      netProfit: koc.netProfit
    };
  });
  
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
    // FIX: Explicitly type the Map and handle potential undefined 'kocAds' to prevent runtime errors and fix type inference.
    const adsByVideoId = new Map<string, TiktokAd>(kocAds?.videos.map(v => [v.videoId, v]) || []);

    const detailsByVideo = new Map<string, {
        revenue: number;
        returnCount: number;
        commission: number;
        productName: string;
    }>();

    for (const order of orders) {
      const videoId = order.videoId || 'no-video';
      if (!detailsByVideo.has(videoId)) {
        detailsByVideo.set(videoId, {
          revenue: 0,
          returnCount: 0,
          commission: 0,
          productName: order.product_name, // Take first product name
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

  // --- Event Handlers ---
  selectKoc(koc: KocPnlData): void {
    this.selectedKoc.set(koc);
  }

  unselectKoc(): void {
    this.selectedKoc.set(null);
  }

  onSortChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as SortKey;
    this.sortKey.set(value);
    this.currentPage.set(1);
  }

  onPageChange(page: number): void {
    this.currentPage.set(page);
  }

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
  
  isFailedOrder(order: EnrichedOrderData): boolean {
    const status = (order.status || '').toLowerCase();
    const failedStatus = ['đã hủy', 'đã đóng', 'thất bại'];
    return failedStatus.some(s => status.includes(s));
  }
}
