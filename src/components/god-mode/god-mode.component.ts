import { Component, ChangeDetectionStrategy, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FinancialsService } from '../../services/financials.service';
import { DataService } from '../../services/data.service';
import { GodModeItem, KocOrderItemDetail } from '../../models/financial.model';

type SortKey = keyof GodModeItem | 'gmv';

@Component({
  selector: 'app-god-mode',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './god-mode.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GodModeComponent {
  financialsService = inject(FinancialsService);
  dataService = inject(DataService);

  // State signals
  sortKey = signal<SortKey>('netProfit');
  sortDirection = signal<'asc' | 'desc'>('desc');
  selectedKoc = signal<GodModeItem | null>(null);
  activeBcgFilter = signal<string>('');
  
  private rawMasterData = this.financialsService.godModeData;

  summary = computed(() => {
    return this.financialsService.calculateGodModeSummary(this.rawMasterData());
  });
  
  masterData = computed(() => {
    const data = this.rawMasterData();
    const summary = this.summary();
    const avgProfit = data.length > 0 ? summary.totalNetProfit / data.length : 0;
    const avgGMV = data.length > 0 ? summary.totalRevenue / data.length : 0;
    return data.map(koc => ({
        ...koc,
        bcgLabel: this.financialsService.classifyBCG(koc, avgGMV, avgProfit)
    }));
  });
  
  bcgGroups = computed(() => {
    const data = this.masterData();
    const groups: { [key: string]: GodModeItem[] } = { STAR: [], COW: [], QUESTION: [], DOG: [] };
    for (const koc of data) {
        if (koc.bcgLabel) {
            groups[koc.bcgLabel].push(koc);
        }
    }
    return groups;
  });

  kocDetails = computed<KocOrderItemDetail[]>(() => {
    const koc = this.selectedKoc();
    if (!koc) return [];
    return this.financialsService.getKocDetails(
      koc.mergeKey,
      this.financialsService.orderData(),
      this.financialsService.inventoryData()
    );
  });

  sortedData = computed(() => {
    let data = this.masterData();
    const filter = this.activeBcgFilter();
    
    if (filter) {
      data = data.filter(item => item.bcgLabel === filter);
    }
    
    const key = this.sortKey();
    const dir = this.sortDirection() === 'asc' ? 1 : -1;

    return [...data].sort((a, b) => {
      const valA = a[key as keyof GodModeItem];
      const valB = b[key as keyof GodModeItem];
      
      if (typeof valA === 'string' && typeof valB === 'string') {
        return valA.localeCompare(valB) * dir;
      }
      if (valA < valB) return -1 * dir;
      if (valA > valB) return 1 * dir;
      return 0;
    });
  });

  selectKoc(item: GodModeItem) {
    if (this.selectedKoc() === item) {
      this.selectedKoc.set(null);
    } else {
      this.selectedKoc.set(item);
    }
  }

  sortBy(key: SortKey) {
    if (this.sortKey() === key) {
      this.sortDirection.update(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortKey.set(key);
      this.sortDirection.set('desc');
    }
  }

  filterBcg(group: string) {
    if (this.activeBcgFilter() === group) {
      this.activeBcgFilter.set('');
    } else {
      this.activeBcgFilter.set(group);
    }
  }
}