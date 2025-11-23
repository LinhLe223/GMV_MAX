import { Component, ChangeDetectionStrategy, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FinancialsService } from '../../services/financials.service';
import { GodModeItem } from '../../models/financial.model';

type SortKey = 'kocName' | 'adsCost' | 'cogs' | 'commission' | 'nmv' | 'realRoas' | 'netProfit';

@Component({
  selector: 'app-god-mode',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './god-mode.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GodModeComponent {
  financialsService = inject(FinancialsService);

  sortKey = signal<SortKey>('netProfit');
  sortDirection = signal<'asc' | 'desc'>('desc');

  private data = this.financialsService.godModeData;

  sortedData = computed(() => {
    const data = this.data();
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

  sort(key: SortKey): void {
    if (this.sortKey() === key) {
      this.sortDirection.update(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortKey.set(key);
      this.sortDirection.set('desc');
    }
  }
}
