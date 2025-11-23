

import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FinancialsService } from '../../services/financials.service';
import { KocPnlData } from '../../models/financial.model';

type SortKey = keyof KocPnlData;

@Component({
  selector: 'app-pnl-report',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pnl-report.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PnlReportComponent {
  financialsService = inject(FinancialsService);

  dashboardMetrics = this.financialsService.dashboardMetrics;
  costStructure = this.financialsService.costStructure;
  inventoryValue = this.financialsService.inventoryValue;

  sortKey = signal<SortKey>('netProfit');
  sortDirection = signal<'asc' | 'desc'>('desc');

  sortedKocPnlData = computed(() => {
    const data = this.financialsService.kocPnlData();
    const key = this.sortKey();
    const dir = this.sortDirection() === 'asc' ? 1 : -1;

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

  onSort(key: SortKey) {
    if (this.sortKey() === key) {
      this.sortDirection.update(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortKey.set(key);
      this.sortDirection.set('desc');
    }
  }
}
