
import { Component, ChangeDetectionStrategy, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from '../../services/data.service';
import { AiAnalyzerComponent } from '../ai-analyzer/ai-analyzer.component';
import { TiktokAd } from '../../models/tiktok-ad.model';

type ChartType = 'bar' | 'table';
type SortDirection = 'asc' | 'desc';
type KocData = {
    kocName: string;
    totalGmv: number;
    totalCost: number;
    videoCount: number;
    videos: TiktokAd[];
    avgRoi: number;
    avgCir: number;
    avgCpc: number;
    avgCtr: number;
    avgCvr: number;
}
type SortKey = keyof Omit<KocData, 'videos'>;


@Component({
  selector: 'app-charts-report',
  standalone: true,
  imports: [CommonModule, AiAnalyzerComponent],
  templateUrl: './charts-report.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChartsReportComponent {
  dataService = inject(DataService);

  products = computed(() => this.dataService.productStats());
  kocsByProduct = computed(() => this.dataService.kocsByProduct());

  selectedProductName = signal<string | null>(null);
  chartType = signal<ChartType>('bar');
  
  // Sorting
  sortKey = signal<SortKey>('totalGmv');
  sortDirection = signal<SortDirection>('desc');

  // Modal
  selectedKoc = signal<KocData | null>(null);
  copiedVideoId = signal<string | null>(null);

  chartData = computed(() => {
    const productName = this.selectedProductName();
    if (!productName) return [];
    
    const data = this.kocsByProduct().get(productName) || [];
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
  
  maxGmvForChart = computed(() => {
    const data = this.chartData();
    // Use the unsorted data for a stable max value
    const unsortedData = this.kocsByProduct().get(this.selectedProductName() || '') || [];
    return unsortedData.length > 0 ? Math.max(...unsortedData.map(koc => koc.totalGmv)) : 1;
  });

  selectProduct(event: Event) {
    const target = event.target as HTMLSelectElement;
    this.selectedProductName.set(target.value || null);
    // Reset sort when product changes
    this.sortKey.set('totalGmv');
    this.sortDirection.set('desc');
  }

  setChartType(type: ChartType) {
    this.chartType.set(type);
  }

  setSort(key: SortKey) {
    if (this.sortKey() === key) {
      this.sortDirection.update(dir => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortKey.set(key);
      this.sortDirection.set('desc');
    }
  }

  openVideoModal(koc: KocData) {
    this.selectedKoc.set(koc);
  }

  closeVideoModal() {
    this.selectedKoc.set(null);
  }
  
  copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      this.copiedVideoId.set(text);
      setTimeout(() => this.copiedVideoId.set(null), 2000);
    }).catch(err => {
      console.error('Failed to copy text: ', err);
    });
  }

  getTikTokVideoUrl(video: TiktokAd): string {
    return `https://www.tiktok.com/@${video.tiktokAccount}/video/${video.videoId}`;
  }

  aiPromptKey = "charts_report_analyzer";

  aiData = computed(() => {
    const productName = this.selectedProductName();
    if (productName) {
       const kocs = this.chartData();
       const dataSummary = {
           "Top 10 KOCs": kocs.slice(0, 10)
       };
       if (kocs.length > 20) {
           dataSummary["Top 5 KOCs kém hiệu quả nhất"] = kocs.slice(-5);
       }
       return {
         "Sản phẩm": productName,
         "Ghi chú": `Phân tích dựa trên ${kocs.length} KOCs, sắp xếp theo ${this.sortKey()} (${this.sortDirection()}). Dưới đây là một mẫu dữ liệu.`,
         "Dữ liệu KOC (mẫu)": dataSummary
       };
    }
    return {
        "Hướng dẫn": "Vui lòng chọn một sản phẩm từ danh sách để xem phân tích chi tiết về KOC.",
        "Tổng số sản phẩm": this.products().length
    };
  });
}
