
import { Component, ChangeDetectionStrategy, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from '../../services/data.service';
import { AiAnalyzerComponent } from '../ai-analyzer/ai-analyzer.component';

@Component({
  selector: 'app-overview',
  standalone: true,
  imports: [CommonModule, AiAnalyzerComponent],
  templateUrl: './overview.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OverviewComponent {
  dataService = inject(DataService);
  stats = this.dataService.summaryStats;
  
  scorecardMetrics = computed(() => {
    const s = this.stats();
    return [
      { label: 'Tổng Doanh thu (GMV)', value: s.totalGmv, format: '1.0-0', unit: ' đ' },
      { label: 'Tổng Chi phí', value: s.totalCost, format: '1.0-0', unit: ' đ' },
      { label: 'Tổng Đơn hàng', value: s.totalOrders, format: '1.0-0', unit: '' },
      { label: 'Tổng Lượt nhấp', value: s.totalClicks, format: '1.0-0', unit: '' },
      { label: 'Tổng Lượt hiển thị', value: s.totalImpressions, format: '1.0-0', unit: '' },
      { label: 'Số lượng KOC', value: s.totalKocs, format: '1.0-0', unit: '' },
      { label: 'Số lượng Video', value: s.totalVideos, format: '1.0-0', unit: '' },
      { label: 'ROI Trung bình', value: s.avgRoi, format: '1.2-2', unit: '' },
      { label: 'CIR Trung bình', value: s.avgCir, format: '1.2-2', unit: '%' },
      { label: 'CPC Trung bình', value: s.avgCpc, format: '1.0-0', unit: ' đ' },
      { label: 'CTR Trung bình', value: s.avgCtr, format: '1.2-2', unit: '%' },
      { label: 'CVR Trung bình', value: s.avgCvr, format: '1.2-2', unit: '%' },
    ];
  });

  maxGmv = computed(() => {
    const topProducts = this.stats().topProducts;
    return topProducts.length > 0 ? Math.max(...topProducts.map(p => p.gmv)) : 1;
  });

  aiPromptKey = "overview_analyzer";
  aiData = computed(() => ({
    "Chỉ số tổng hợp": {
      "Tổng Doanh thu (GMV)": this.stats().totalGmv,
      "Tổng Chi phí": this.stats().totalCost,
      "Tổng Đơn hàng": this.stats().totalOrders,
      "Tổng Lượt nhấp": this.stats().totalClicks,
      "Tổng Lượt hiển thị": this.stats().totalImpressions,
      "Số lượng KOC": this.stats().totalKocs,
      "Số lượng Video": this.stats().totalVideos,
      "ROI trung bình": this.stats().avgRoi,
      "CIR trung bình (%)": this.stats().avgCir,
      "CPC trung bình": this.stats().avgCpc,
      "CTR trung bình (%)": this.stats().avgCtr,
      "CVR trung bình (%)": this.stats().avgCvr
    },
    "Top 10 Sản phẩm theo Doanh thu": this.stats().topProducts
  }));
}
