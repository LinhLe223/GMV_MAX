import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from '../../services/data.service';
import { TiktokAd } from '../../models/tiktok-ad.model';
import { AiAnalyzerComponent } from '../ai-analyzer/ai-analyzer.component';
import { PaginationComponent } from '../pagination/pagination.component';

type SortKey = keyof TiktokAd;
type SortDirection = 'asc' | 'desc';

@Component({
  selector: 'app-video-report',
  standalone: true,
  imports: [CommonModule, AiAnalyzerComponent, PaginationComponent],
  templateUrl: './video-report.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VideoReportComponent {
  dataService = inject(DataService);
  sortKey = signal<SortKey>('gmv');
  sortDirection = signal<SortDirection>('desc');
  copiedVideoId = signal<string | null>(null);

  // Pagination state
  currentPage = signal(1);
  itemsPerPage = signal(20);

  sortedVideos = computed(() => {
    const data = this.dataService.videoData(); // Use filtered video data
    const key = this.sortKey();
    const dir = this.sortDirection() === 'asc' ? 1 : -1;

    return [...data].sort((a, b) => {
        if (a[key] < b[key]) return -1 * dir;
        if (a[key] > b[key]) return 1 * dir;
        return 0;
    });
  });

  paginatedVideos = computed(() => {
    const sorted = this.sortedVideos();
    const page = this.currentPage();
    const perPage = this.itemsPerPage();
    if (perPage >= sorted.length) {
      return sorted;
    }
    const start = (page - 1) * perPage;
    const end = start + perPage;
    return sorted.slice(start, end);
  });

  roiDistribution = computed(() => {
    const videos = this.dataService.videoData(); // Use filtered video data
    if (videos.length === 0) return { bins: [], maxCount: 0 };
    
    const bins = [
      { label: 'ROI < 1 (Kém)', range: (r: number) => r < 1, count: 0, color: 'bg-red-500' },
      { label: '1 ≤ ROI < 2 (TB)', range: (r: number) => r >= 1 && r < 2, count: 0, color: 'bg-yellow-500' },
      { label: '2 ≤ ROI < 4 (Tốt)', range: (r: number) => r >= 2 && r < 4, count: 0, color: 'bg-blue-500' },
      { label: 'ROI ≥ 4 (Rất Tốt)', range: (r: number) => r >= 4, count: 0, color: 'bg-green-500' },
    ];
    
    for (const video of videos) {
      for (const bin of bins) {
        if (bin.range(video.roi)) {
          bin.count++;
          break;
        }
      }
    }
    
    const maxCount = Math.max(...bins.map(b => b.count));
    
    return { bins, maxCount: maxCount > 0 ? maxCount : 1 };
  });

  aiPromptKey = "video_report_analyzer";
  
  aiData = computed(() => {
    const videos = this.sortedVideos();
    const dataSummary = {
        "Top 20 video": videos.slice(0, 20)
    };
    if (videos.length > 40) {
        dataSummary["Top 10 video kém hiệu quả nhất"] = videos.slice(-10);
    }
    return {
        "Ghi chú": `Phân tích dựa trên ${videos.length} videos, sắp xếp theo ${this.sortKey()} (${this.sortDirection()}). Dưới đây là một mẫu dữ liệu.`,
        "Dữ liệu Video (mẫu)": dataSummary
    };
  });

  setSort(key: SortKey) {
    if (this.sortKey() === key) {
      this.sortDirection.set(this.sortDirection() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortKey.set(key);
      this.sortDirection.set('desc');
    }
    this.currentPage.set(1);
  }
  
  copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      this.copiedVideoId.set(text);
      setTimeout(() => this.copiedVideoId.set(null), 2000);
    }).catch(err => {
      console.error('Failed to copy text: ', err);
    });
  }

  // Pagination handlers
  onPageChange(page: number): void {
    this.currentPage.set(page);
  }

  onItemsPerPageChange(perPage: number): void {
    this.itemsPerPage.set(perPage);
    this.currentPage.set(1); // Reset to first page
  }
}
