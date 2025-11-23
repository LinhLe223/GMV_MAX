

import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FinancialsService } from '../../services/financials.service';

@Component({
  selector: 'app-pnl-report',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pnl-report.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PnlReportComponent {
  financialsService = inject(FinancialsService);

  kocPnlData = this.financialsService.kocPnlData;
  dashboardMetrics = this.financialsService.dashboardMetrics;
  costStructure = this.financialsService.costStructure;
  inventoryValue = this.financialsService.inventoryValue;
}
