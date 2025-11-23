



import { Component, ChangeDetectionStrategy, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FinancialsService } from '../../services/financials.service';
import { KocPnlData, EnrichedOrderData } from '../../models/financial.model';
import { PaginationComponent } from '../pagination/pagination.component';
import { DataService } from '../../services/data.service';

type SortKey = 
  | 'netProfit_desc' 
  | 'netProfit_asc' 
  | 'nmv_desc' 
  | 'returnCancelPercent_asc'
  | 'totalCommission_desc'
  | 'totalCogs_desc'
  | 'adsCost_desc';


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
  
  isFailedOrder(order: EnrichedOrderData): boolean {
    const status = (order.status || '').toLowerCase();
    const failedStatus = ['đã hủy', 'đã đóng', 'thất bại'];
    return failedStatus.some(s => status.includes(s));
  }
}
