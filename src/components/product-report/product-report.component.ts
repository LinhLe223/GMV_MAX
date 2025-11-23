import { Component, ChangeDetectionStrategy, computed, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService, ProductStat } from '../../services/data.service';
import { TiktokAd } from '../../models/tiktok-ad.model';
import { AiAnalyzerComponent } from '../ai-analyzer/ai-analyzer.component';
import { PaginationComponent } from '../pagination/pagination.component';

type ProductViewTab = 'list' | 'chart';
type DetailViewTab = 'all' | 'koc';
type VideoSortKey = keyof TiktokAd;
type SortDirection = 'asc' | 'desc';

@Component({
  selector: 'app-product-report',
  standalone: true,
  imports: [CommonModule, AiAnalyzerComponent, PaginationComponent],
  templateUrl: './product-report.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductReportComponent {
  dataService = inject(DataService);
  
  selectedProduct = signal<ProductStat | null>(null);
  activeTab = signal<ProductViewTab>('list');
  activeDetailTab = signal<DetailViewTab>('all');
  roiFilter = signal<string>('all');
  
  // Sorting state for detail view videos
  videoSortKey = signal<VideoSortKey>('gmv');
  videoSortDirection = signal<SortDirection>('desc');

  // --- Pagination State ---
  videosCurrentPage = signal(1);
  videosItemsPerPage = signal(20);
  kocsCurrentPage = signal(1);
  kocsItemsPerPage = signal(10); // Fewer KOCs per page as they have nested tables

  constructor() {
    effect(() => {
      // When the filter changes, reset pagination for both tabs
      this.roiFilter();
      this.videosCurrentPage.set(1);
      this.kocsCurrentPage.set(1);
    });
  }

  roiFilterOptions = [
    { value: 'all', label: 'Tất cả ROI' },
    { value: '>4', label: 'ROI > 4 (Hiệu quả cao)' },
    { value: '>2', label: 'ROI > 2' },
    { value: '<1', label: 'ROI < 1 (Cần tối ưu)' },
    { value: '0', label: 'ROI = 0' }
  ];

  // --- Main View ---
  summary = this.dataService.productReportSummary;
  products = this.dataService.productStats;
  
  // --- Chart Data ---
  topProductsForChart = computed(() => {
    return this.products().slice(0, 10);
  });
  maxGmvForChart = computed(() => {
    const top = this.topProductsForChart();
    return top.length > 0 ? Math.max(...top.map(p => p.totalGmv)) : 1;
  });

  bcgMatrixData = computed(() => {
    const products = this.products();
    if (products.length === 0) {
      return {
        points: [],
        medianGmv: 0,
        roiThreshold: 4.0,
        maxGmv: 1,
        maxRoi: 1,
        categoryCounts: { Star: 0, QuestionMark: 0, CashCow: 0, Dog: 0 },
      };
    }

    // Calculate thresholds
    const roiThreshold = 4.0;
    const gmvs = products.map(p => p.totalGmv).sort((a, b) => a - b);
    const mid = Math.floor(gmvs.length / 2);
    const medianGmv = gmvs.length % 2 === 0 ? (gmvs[mid - 1] + gmvs[mid]) / 2 : gmvs[mid];

    // Prepare for chart scaling
    const maxRoi = Math.max(...products.map(p => p.avgRoi), roiThreshold * 1.2);
    const maxGmv = Math.max(...gmvs, medianGmv * 1.2);
    const maxCost = Math.max(...products.map(p => p.totalCost)) || 1;

    const categoryCounts = { Star: 0, QuestionMark: 0, CashCow: 0, Dog: 0 };
    
    const categoryStyles: { [key: string]: { label: string; color: string; } } = {
        Star: { label: '🌟 Ngôi sao', color: 'border-yellow-500 bg-yellow-400/70 hover:bg-yellow-500/80' },
        QuestionMark: { label: '💎 Tiềm năng', color: 'border-blue-600 bg-blue-500/70 hover:bg-blue-600/80' },
        CashCow: { label: '🐮 Bò sữa', color: 'border-green-600 bg-green-500/70 hover:bg-green-600/80' },
        Dog: { label: '🐕 Kém hiệu quả', color: 'border-gray-500 bg-gray-400/70 hover:bg-gray-500/80' }
    };

    const points = products.map(p => {
      const isHighGmv = p.totalGmv >= medianGmv;
      const isHighRoi = p.avgRoi >= roiThreshold;
      let categoryKey: keyof typeof categoryCounts;

      if (isHighRoi && isHighGmv) categoryKey = 'Star';
      else if (isHighRoi && !isHighGmv) categoryKey = 'QuestionMark';
      else if (!isHighRoi && isHighGmv) categoryKey = 'CashCow';
      else categoryKey = 'Dog';
      
      categoryCounts[categoryKey]++;

      return {
        product: p,
        category: categoryStyles[categoryKey].label,
        color: categoryStyles[categoryKey].color,
        // User wants ROI on X axis, GMV on Y axis
        x: (p.avgRoi / maxRoi) * 100, 
        y: (p.totalGmv / maxGmv) * 100,
        // Size based on cost
        size: Math.sqrt(p.totalCost / maxCost) * 40 + 10 // min size 10px, max 50px
      };
    });

    return {
      points,
      medianGmv,
      roiThreshold,
      maxGmv: maxGmv > 0 ? maxGmv : 1,
      maxRoi: maxRoi > 0 ? maxRoi : 1,
      categoryCounts,
    };
  });

  // --- Detail View ---
  private videosAfterRoiFilter = computed(() => {
    const product = this.selectedProduct();
    if (!product) return [];
    
    const filter = this.roiFilter();
    if (filter === 'all') {
      return product.videos;
    }

    return product.videos.filter(v => {
      switch (filter) {
        case '>4': return v.roi > 4;
        case '>2': return v.roi > 2;
        case '<1': return v.roi < 1;
        case '0': return v.roi === 0;
        default: return true;
      }
    });
  });

  videosForSelectedProduct = computed(() => {
    if (this.activeDetailTab() !== 'all') return [];

    const key = this.videoSortKey();
    const dir = this.videoSortDirection() === 'asc' ? 1 : -1;
    
    return [...this.videosAfterRoiFilter()].sort((a, b) => {
        if (a[key] < b[key]) return -1 * dir;
        if (a[key] > b[key]) return 1 * dir;
        return 0;
    });
  });

  paginatedVideos = computed(() => {
    const data = this.videosForSelectedProduct();
    const page = this.videosCurrentPage();
    const perPage = this.videosItemsPerPage();
    if (perPage >= data.length) return data;
    const start = (page - 1) * perPage;
    const end = start + perPage;
    return data.slice(start, end);
  });
  
  kocsForSelectedProduct = computed(() => {
    if (this.activeDetailTab() !== 'koc') return [];
    
    const videos = this.videosAfterRoiFilter();
    const kocMap = new Map<string, TiktokAd[]>();

    for (const video of videos) {
      if (!kocMap.has(video.tiktokAccount)) {
        kocMap.set(video.tiktokAccount, []);
      }
      kocMap.get(video.tiktokAccount)!.push(video);
    }
    
    const key = this.videoSortKey();
    const dir = this.videoSortDirection() === 'asc' ? 1 : -1;

    return Array.from(kocMap.entries()).map(([kocName, vids]) => ({
      kocName,
      videos: [...vids].sort((a, b) => {
        if (a[key] < b[key]) return -1 * dir;
        if (a[key] > b[key]) return 1 * dir;
        return 0;
      })
    })).sort((a,b) => b.videos.reduce((s, v) => s + v.gmv, 0) - a.videos.reduce((s, v) => s + v.gmv, 0));
  });

  paginatedKocs = computed(() => {
    const data = this.kocsForSelectedProduct();
    const page = this.kocsCurrentPage();
    const perPage = this.kocsItemsPerPage();
    if (perPage >= data.length) return data;
    const start = (page - 1) * perPage;
    const end = start + perPage;
    return data.slice(start, end);
  });

  selectProduct(product: ProductStat) {
    this.selectedProduct.set(product);
    this.activeDetailTab.set('all'); // Default to all videos view
    this.roiFilter.set('all'); // Reset filter
    this.videosCurrentPage.set(1);
    this.kocsCurrentPage.set(1);
  }
  
  unselectProduct() {
    this.selectedProduct.set(null);
  }

  setTab(tab: ProductViewTab) {
    this.activeTab.set(tab);
  }
  
  setDetailTab(tab: DetailViewTab) {
    this.activeDetailTab.set(tab);
    this.videosCurrentPage.set(1);
    this.kocsCurrentPage.set(1);
  }
  
  setVideoSort(key: VideoSortKey) {
    if (this.videoSortKey() === key) {
      this.videoSortDirection.update(dir => dir === 'asc' ? 'desc' : 'asc');
    } else {
      this.videoSortKey.set(key);
      this.videoSortDirection.set('desc');
    }
    this.videosCurrentPage.set(1);
    this.kocsCurrentPage.set(1);
  }

  getTikTokVideoUrl(video: TiktokAd): string {
    return `https://www.tiktok.com/@${video.tiktokAccount}/video/${video.videoId}`;
  }

  aiPromptKey = computed(() => {
    return this.selectedProduct() ? 'product_detail_analyzer' : 'product_report_analyzer';
  });

  aiData = computed(() => {
    const product = this.selectedProduct();
    if (product) {
       let dataSummary;
       if (this.activeDetailTab() === 'all') {
           const videos = this.videosForSelectedProduct();
           const topVideos = videos.slice(0, 10);
           const bottomVideos = videos.length > 20 ? videos.slice(-5) : [];
           dataSummary = {
               "Tổng số video phù hợp": videos.length,
               "Top 10 video": topVideos
           };
            if (bottomVideos.length > 0) {
              dataSummary["Top 5 video kém hiệu quả nhất"] = bottomVideos;
            }
       } else { // 'koc' tab
           const kocs = this.kocsForSelectedProduct();
           const topKocs = kocs.slice(0, 10).map(koc => ({
               kocName: koc.kocName,
               videoCount: koc.videos.length,
               totalGmv: koc.videos.reduce((sum, v) => sum + v.gmv, 0),
               top2Videos: koc.videos.slice(0, 2) 
           }));
           dataSummary = {
               "Tổng số KOCs phù hợp": kocs.length,
               "Top 10 KOCs (với top 2 videos mỗi KOC)": topKocs
           };
       }

       return {
         "Sản phẩm": product.productName,
         "Tổng Doanh thu": product.totalGmv,
         "ROI Trung bình": product.avgRoi,
         "Bộ lọc ROI": this.roiFilter(),
         "Tab đang xem": this.activeDetailTab() === 'all' ? 'Tất cả video' : 'Theo KOC',
         "Sắp xếp theo": `${this.videoSortKey()} (${this.videoSortDirection()})`,
         "Dữ liệu (mẫu)": dataSummary
       };
    }

    const products = this.products();
    return {
        "Ghi chú": "Phân tích tổng quan dựa trên top 20 sản phẩm theo GMV.",
        "Tổng số sản phẩm": products.length,
        "Dữ liệu (mẫu)": products.slice(0, 20)
    };
  });

  // --- Pagination Handlers ---
  onVideosPageChange(page: number) { this.videosCurrentPage.set(page); }
  onVideosItemsPerPageChange(perPage: number) {
    this.videosItemsPerPage.set(perPage);
    this.videosCurrentPage.set(1);
  }
  onKocsPageChange(page: number) { this.kocsCurrentPage.set(page); }
  onKocsItemsPerPageChange(perPage: number) {
    this.kocsItemsPerPage.set(perPage);
    this.kocsCurrentPage.set(1);
  }
}
