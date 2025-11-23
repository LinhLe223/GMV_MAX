import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from '../../services/data.service';
import { TiktokAd } from '../../models/tiktok-ad.model';
import { AiAnalyzerComponent } from '../ai-analyzer/ai-analyzer.component';
import { PaginationComponent } from '../pagination/pagination.component';

type VideoSortKey = 'gmv' | 'roi' | 'cir';
type SortDirection = 'asc' | 'desc';

@Component({
  selector: 'app-deep-dive',
  standalone: true,
  imports: [CommonModule, AiAnalyzerComponent, PaginationComponent],
  templateUrl: './deep-dive.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeepDiveComponent {
  dataService = inject(DataService);

  selectedProductId = signal<string | null>(null);
  selectedKoc = signal<string | null>(null);

  // Video sorting state
  videoSortKey = signal<VideoSortKey>('gmv');
  videoSortDirection = signal<SortDirection>('desc');

  // --- Pagination State ---
  // Level 1: Products
  productsCurrentPage = signal(1);
  productsItemsPerPage = signal(20);

  // Level 2: KOCs
  kocsCurrentPage = signal(1);
  kocsItemsPerPage = signal(20);

  // Level 3: Videos
  videosCurrentPage = signal(1);
  videosItemsPerPage = signal(20);

  // Level 1: Products
  products = computed(() => {
    const productMap = new Map<string, { gmv: number, cost: number }>();
    for (const row of this.dataService.videoData()) { // Use filtered video data
      const existing = productMap.get(row.productId) || { gmv: 0, cost: 0 };
      existing.gmv += row.gmv;
      existing.cost += row.cost;
      productMap.set(row.productId, existing);
    }
    return Array.from(productMap.entries())
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.gmv - a.gmv);
  });

  paginatedProducts = computed(() => {
    const data = this.products();
    const page = this.productsCurrentPage();
    const perPage = this.productsItemsPerPage();
    if (perPage >= data.length) return data;
    const start = (page - 1) * perPage;
    const end = start + perPage;
    return data.slice(start, end);
  });

  // Level 2: KOCs for selected product
  kocsForSelectedProduct = computed(() => {
    const productId = this.selectedProductId();
    if (!productId) return [];
    
    const kocMap = new Map<string, { gmv: number, cost: number, videoCount: number }>();
    for (const row of this.dataService.videoData()) { // Use filtered video data
      if (row.productId === productId) {
        const existing = kocMap.get(row.tiktokAccount) || { gmv: 0, cost: 0, videoCount: 0 };
        existing.gmv += row.gmv;
        existing.cost += row.cost;
        existing.videoCount++;
        kocMap.set(row.tiktokAccount, existing);
      }
    }
    return Array.from(kocMap.entries())
      .map(([name, data]) => ({ name, ...data, roi: data.cost > 0 ? data.gmv / data.cost : 0 }))
      .sort((a, b) => b.gmv - a.gmv);
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

  // Level 3: Videos for selected product and KOC
  videosForSelectedKoc = computed(() => {
    const productId = this.selectedProductId();
    const koc = this.selectedKoc();
    if (!productId || !koc) return [];

    const key = this.videoSortKey();
    const dir = this.videoSortDirection() === 'asc' ? 1 : -1;

    const videos = this.dataService.videoData() // Use filtered video data
      .filter(row => row.productId === productId && row.tiktokAccount === koc);

    return [...videos].sort((a, b) => {
        if (a[key] < b[key]) return -1 * dir;
        if (a[key] > b[key]) return 1 * dir;
        return 0;
    });
  });

  paginatedVideos = computed(() => {
    const data = this.videosForSelectedKoc();
    const page = this.videosCurrentPage();
    const perPage = this.videosItemsPerPage();
    if (perPage >= data.length) return data;
    const start = (page - 1) * perPage;
    const end = start + perPage;
    return data.slice(start, end);
  });

  selectProduct(productId: string) {
    if (this.selectedProductId() === productId) {
      this.selectedProductId.set(null); // Deselect if clicking the same one
      this.selectedKoc.set(null);
    } else {
      this.selectedProductId.set(productId);
      this.selectedKoc.set(null);
      // Reset child pagination
      this.kocsCurrentPage.set(1);
      this.videosCurrentPage.set(1);
    }
  }

  selectKoc(koc: string) {
    if (this.selectedKoc() === koc) {
      this.selectedKoc.set(null); // Deselect
    } else {
      this.selectedKoc.set(koc);
       // Reset child pagination
      this.videosCurrentPage.set(1);
    }
  }

  // Method to handle video sorting
  setVideoSort(key: VideoSortKey) {
    if (this.videoSortKey() === key) {
      this.videoSortDirection.update(dir => dir === 'asc' ? 'desc' : 'asc');
    } else {
      this.videoSortKey.set(key);
      this.videoSortDirection.set('desc');
    }
    this.videosCurrentPage.set(1);
  }

  // --- Pagination Handlers ---
  onProductsPageChange(page: number) { this.productsCurrentPage.set(page); }
  onProductsItemsPerPageChange(perPage: number) {
    this.productsItemsPerPage.set(perPage);
    this.productsCurrentPage.set(1);
  }
  onKocsPageChange(page: number) { this.kocsCurrentPage.set(page); }
  onKocsItemsPerPageChange(perPage: number) {
    this.kocsItemsPerPage.set(perPage);
    this.kocsCurrentPage.set(1);
  }
  onVideosPageChange(page: number) { this.videosCurrentPage.set(page); }
  onVideosItemsPerPageChange(perPage: number) {
    this.videosItemsPerPage.set(perPage);
    this.videosCurrentPage.set(1);
  }

  aiPromptKey = "deep_dive_analyzer";
  
  aiData = computed(() => {
    const productId = this.selectedProductId();
    const kocName = this.selectedKoc();

    if (!productId) {
        const products = this.products();
        return {
            context: "Danh sách sản phẩm (Top 20 theo GMV)",
            totalProducts: products.length,
            data: products.slice(0, 20)
        };
    }

    if (!kocName) {
        const kocs = this.kocsForSelectedProduct();
        const dataSummary = {
            "Top 10 KOCs": kocs.slice(0, 10)
        };
        if (kocs.length > 20) {
            dataSummary["Top 5 KOCs kém hiệu quả nhất"] = kocs.slice(-5);
        }
        return {
            context: `KOCs cho sản phẩm ${productId}`,
            totalKocs: kocs.length,
            data: dataSummary
        };
    }
    
    const videos = this.videosForSelectedKoc();
    const dataSummary = {
        "Top 10 video": videos.slice(0, 10)
    };
    if (videos.length > 20) {
        dataSummary["Top 5 video kém hiệu quả nhất"] = videos.slice(-5);
    }
    return {
        context: `Videos của KOC ${kocName} cho sản phẩm ${productId}`,
        totalVideos: videos.length,
        data: dataSummary
    };
  });
}
