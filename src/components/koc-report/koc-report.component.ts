import { Component, ChangeDetectionStrategy, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService, KocReportStat } from '../../services/data.service';
import { AiAnalyzerComponent } from '../ai-analyzer/ai-analyzer.component';
import { TiktokAd } from '../../models/tiktok-ad.model';

type SummarySortKey = 'name' | 'totalGmv' | 'totalCost' | 'totalOrders' | 'avgRoi';
type VideoSortKey = keyof TiktokAd;
type SortDirection = 'asc' | 'desc';

@Component({
  selector: 'app-koc-report',
  standalone: true,
  imports: [CommonModule, AiAnalyzerComponent],
  templateUrl: './koc-report.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KocReportComponent {
  dataService = inject(DataService);

  selectedKoc = signal<KocReportStat | null>(null);

  // Summary view sorting
  summarySortKey = signal<SummarySortKey>('totalGmv');
  summarySortDirection = signal<SortDirection>('desc');

  // Detail view sorting
  videoSortKey = signal<VideoSortKey>('gmv');
  videoSortDirection = signal<SortDirection>('desc');
  
  // Data for summary view
  sortedKocs = computed(() => {
    const kocs = this.dataService.kocReportStats();
    const key = this.summarySortKey();
    const dir = this.summarySortDirection() === 'asc' ? 1 : -1;
    
    return [...kocs].sort((a, b) => {
        if (key === 'name') {
          return a.name.localeCompare(b.name) * dir;
        }
        if (a[key] < b[key]) return -1 * dir;
        if (a[key] > b[key]) return 1 * dir;
        return 0;
    });
  });

  top3Kocs = computed(() => this.sortedKocs().slice(0, 3));
  otherKocs = computed(() => this.sortedKocs().slice(3));

  maxGmvForOtherKocs = computed(() => {
    const others = this.otherKocs();
    return others.length > 0 ? Math.max(...others.map(k => k.totalGmv)) : 1;
  });
  
  // Data for detail view
  sortedVideos = computed(() => {
    const koc = this.selectedKoc();
    if (!koc) return [];
    
    const key = this.videoSortKey();
    const dir = this.videoSortDirection() === 'asc' ? 1 : -1;
    
    return [...koc.videos].sort((a, b) => {
        if (a[key] < b[key]) return -1 * dir;
        if (a[key] > b[key]) return 1 * dir;
        return 0;
    });
  });

  aiPromptKey = computed(() => {
    return this.selectedKoc() ? 'koc_detail_analyzer' : 'koc_report_analyzer';
  });

  aiData = computed(() => {
    const koc = this.selectedKoc();
    if (koc) {
      const videos = this.sortedVideos();
      const dataSummary = {
        "Top 10 video": videos.slice(0, 10)
      };
      if (videos.length > 20) {
        dataSummary["Top 5 video kém hiệu quả nhất"] = videos.slice(-5);
      }
      return {
        "KOC": koc.name,
        "Tổng hợp chỉ số": {
            "Tổng Doanh thu": koc.totalGmv,
            "Tổng Chi phí": koc.totalCost,
            "Tổng Đơn hàng": koc.totalOrders,
            "ROI Trung bình": koc.avgRoi,
            "CIR Trung bình": koc.avgCir,
            "Số sản phẩm": koc.productCount,
            "Số video": koc.videoCount
        },
        "Ghi chú": `Phân tích dựa trên ${videos.length} videos, sắp xếp theo ${this.videoSortKey()} (${this.videoSortDirection()}). Dưới đây là một mẫu dữ liệu.`,
        "Dữ liệu video (mẫu)": dataSummary
      };
    }
    
    const kocs = this.sortedKocs();
    const dataSummary = {
      "Top 10 KOCs": kocs.slice(0, 10)
    };
    if (kocs.length > 20) {
      dataSummary["Top 5 KOCs kém hiệu quả nhất"] = kocs.slice(-5);
    }
    return {
      "Ghi chú": `Phân tích dựa trên ${kocs.length} KOCs, sắp xếp theo ${this.summarySortKey()} (${this.summarySortDirection()}). Dưới đây là một mẫu dữ liệu.`,
      "Dữ liệu KOC (mẫu)": dataSummary
    };
  });

  selectKoc(koc: KocReportStat) {
    this.selectedKoc.set(koc);
  }

  unselectKoc() {
    this.selectedKoc.set(null);
  }
  
  setSummarySort(key: SummarySortKey) {
    if (this.summarySortKey() === key) {
      this.summarySortDirection.update(dir => dir === 'asc' ? 'desc' : 'asc');
    } else {
      this.summarySortKey.set(key);
      this.summarySortDirection.set('desc');
    }
  }

  setVideoSort(key: VideoSortKey) {
    if (this.videoSortKey() === key) {
      this.videoSortDirection.update(dir => dir === 'asc' ? 'desc' : 'asc');
    } else {
      this.videoSortKey.set(key);
      this.videoSortDirection.set('desc');
    }
  }

  getTikTokVideoUrl(video: TiktokAd): string {
    return `https://www.tiktok.com/@${video.tiktokAccount}/video/${video.videoId}`;
  }
}