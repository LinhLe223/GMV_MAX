

import { Injectable, signal, computed } from '@angular/core';
import { TiktokAd } from '../models/tiktok-ad.model';

export interface ProductStat {
  productName: string;
  totalGmv: number;
  totalCost: number;
  avgRoi: number;
  videoCount: number;
  kocCount: number;
  effectiveVideoCount: number;
  videos: TiktokAd[];
  topKoc: { name: string; gmv: number } | null;
  topVideo: { title:string; roi: number } | null;
}

export interface KocReportStat {
  name: string;
  totalGmv: number;
  totalCost: number;
  totalOrders: number;
  avgRoi: number;
  avgCir: number;
  productCount: number;
  videoCount: number;
  videos: TiktokAd[];
  effectiveVideoCount: number;
  topProduct: { name: string; gmv: number } | null;
}

const DATA_CACHE_KEY = 'tiktok_analyzer_data_cache';

@Injectable({
  providedIn: 'root',
})
export class DataService {
  rawData = signal<TiktokAd[]>([]);
  fileName = signal<string>('');
  dataLoaded = computed(() => this.rawData().length > 0);
  error = signal<string | null>(null);

  constructor() {
    this.loadDataFromCache();
  }

  private loadDataFromCache() {
    const cacheJson = localStorage.getItem(DATA_CACHE_KEY);
    if (cacheJson) {
      try {
        const cache = JSON.parse(cacheJson);
        const dataArray: TiktokAd[] = JSON.parse(cache.data);
        this.rawData.set(dataArray);
        this.fileName.set(cache.fileName);
      } catch (e) {
        console.error("Failed to load data from cache", e);
        localStorage.removeItem(DATA_CACHE_KEY);
      }
    }
  }

  /**
   * Contains only data rows related to KOC videos.
   * Filters out 'Thẻ sản phẩm' and entries with unknown KOCs.
   * This is used for KOC, Video, and Deep-dive reports.
   */
  videoData = computed(() => {
    return this.rawData().filter(row => 
      row.creativeType?.toLowerCase().trim() === 'video' && 
      row.tiktokAccount !== 'Unknown'
    );
  });

  summaryStats = computed(() => {
    const data = this.rawData(); // Uses all data
    if (data.length === 0) {
      return {
        totalGmv: 0, totalCost: 0, avgRoi: 0, avgCir: 0,
        avgCpc: 0, avgCtr: 0, avgCvr: 0,
        topProducts: [],
        totalImpressions: 0,
        totalOrders: 0,
        totalClicks: 0,
        totalKocs: 0,
        totalVideos: 0,
      };
    }

    const totalGmv = data.reduce((acc, row) => acc + row.gmv, 0);
    const totalCost = data.reduce((acc, row) => acc + row.cost, 0);
    const totalImpressions = data.reduce((acc, row) => acc + row.impressions, 0);
    const totalClicks = data.reduce((acc, row) => acc + row.clicks, 0);
    const totalOrders = data.reduce((acc, row) => acc + row.orders, 0);
    
    // KOCs and Videos are counted from the filtered video data for accuracy
    const videoOnlyData = this.videoData();
    const totalKocs = new Set(videoOnlyData.map(d => d.tiktokAccount)).size;
    const totalVideos = new Set(videoOnlyData.map(d => d.videoId)).size;

    const avgRoi = totalCost > 0 ? (totalGmv / totalCost) : 0;
    const avgCir = totalGmv > 0 ? (totalCost / totalGmv) * 100 : 0;
    const avgCpc = totalClicks > 0 ? totalCost / totalClicks : 0;
    const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
    
    const totalWeightedConversionsValue = data.reduce((acc, row) => acc + (row.clicks * row.cvr), 0);
    const avgCvr = totalClicks > 0 ? totalWeightedConversionsValue / totalClicks : 0;

    const productGmv = data.reduce((acc, row) => {
        acc[row.productId] = (acc[row.productId] || 0) + row.gmv;
        return acc;
    }, {} as Record<string, number>);

    const topProducts = Object.entries(productGmv)
        .map(([productId, gmv]) => ({ productId, gmv }))
        .sort((a, b) => Number(b.gmv) - Number(a.gmv))
        .slice(0, 10);
        
    return { 
      totalGmv, totalCost, avgRoi, avgCir, avgCpc, avgCtr, avgCvr, topProducts,
      totalImpressions, totalOrders, totalClicks, totalKocs, totalVideos
    };
  });

  productStats = computed<ProductStat[]>(() => {
    const data = this.rawData(); // Uses all data
    const statsByCampaign = new Map<string, {
      gmv: number;
      cost: number;
      videos: Set<string>;
      kocs: Set<string>;
      effectiveVideos: Set<string>;
      records: TiktokAd[];
    }>();

    for(const row of data) {
      if (!statsByCampaign.has(row.campaignName)) {
        statsByCampaign.set(row.campaignName, {
          gmv: 0,
          cost: 0,
          videos: new Set(),
          kocs: new Set(),
          effectiveVideos: new Set(),
          records: [],
        });
      }
      const stats = statsByCampaign.get(row.campaignName)!;
      stats.gmv += row.gmv;
      stats.cost += row.cost;
      // Only count KOCs and videos if they are from actual video creatives
      if (row.creativeType?.toLowerCase().trim() === 'video' && row.tiktokAccount !== 'Unknown') {
        stats.videos.add(row.videoId);
        stats.kocs.add(row.tiktokAccount);
        if(row.roi > 4) {
          stats.effectiveVideos.add(row.videoId);
        }
      }
      stats.records.push(row);
    }
    
    return Array.from(statsByCampaign.entries()).map(([name, stats]) => {
      const campaignVideos = stats.records.filter(r => r.creativeType?.toLowerCase().trim() === 'video' && r.tiktokAccount !== 'Unknown');

      const kocsInCampaign = new Map<string, number>();
      for (const video of campaignVideos) {
          kocsInCampaign.set(video.tiktokAccount, (kocsInCampaign.get(video.tiktokAccount) || 0) + video.gmv);
      }
      const topKocEntry = [...kocsInCampaign.entries()].sort((a, b) => b[1] - a[1])[0];
      const topKoc = topKocEntry ? { name: topKocEntry[0], gmv: topKocEntry[1] } : null;

      const topVideo = [...campaignVideos].sort((a, b) => b.roi - a.roi)[0] || null;

      return {
        productName: name,
        totalGmv: stats.gmv,
        totalCost: stats.cost,
        avgRoi: stats.cost > 0 ? stats.gmv / stats.cost : 0,
        videoCount: stats.videos.size,
        kocCount: stats.kocs.size,
        effectiveVideoCount: stats.effectiveVideos.size,
        videos: stats.records,
        topKoc,
        topVideo: topVideo ? { title: topVideo.videoTitle, roi: topVideo.roi } : null,
      }
    }).sort((a, b) => b.totalGmv - a.totalGmv);
  });

  productReportSummary = computed(() => {
    const data = this.rawData(); // Uses all data
    const summary = this.summaryStats();
    return {
      totalProducts: this.productStats().length,
      totalVideos: new Set(this.videoData().map(d => d.videoId)).size,
      totalGmv: summary.totalGmv,
      totalCost: summary.totalCost
    };
  });

  kocReportStats = computed<KocReportStat[]>(() => {
    const data = this.videoData(); // Uses KOC/Video data only
    const statsByName = new Map<string, {
        gmv: number;
        cost: number;
        orders: number;
        products: Set<string>;
        videos: TiktokAd[];
    }>();

    for(const row of data) {
        if (!statsByName.has(row.tiktokAccount)) {
            statsByName.set(row.tiktokAccount, {
                gmv: 0,
                cost: 0,
                orders: 0,
                products: new Set(),
                videos: [],
            });
        }
        const stats = statsByName.get(row.tiktokAccount)!;
        stats.gmv += row.gmv;
        stats.cost += row.cost;
        stats.orders += row.orders;
        stats.products.add(row.campaignName);
        stats.videos.push(row);
    }

    return Array.from(statsByName.entries()).map(([name, stats]) => {
        const effectiveVideoCount = stats.videos.filter(v => v.roi > 4).length;
        
        const productGmv = new Map<string, number>();
        for (const video of stats.videos) {
            productGmv.set(video.campaignName, (productGmv.get(video.campaignName) || 0) + video.gmv);
        }

        const topProductEntry = [...productGmv.entries()].sort((a, b) => b[1] - a[1])[0];
        const topProduct = topProductEntry ? { name: topProductEntry[0], gmv: topProductEntry[1] } : null;

        return {
            name,
            totalGmv: stats.gmv,
            totalCost: stats.cost,
            totalOrders: stats.orders,
            avgRoi: stats.cost > 0 ? stats.gmv / stats.cost : 0,
            avgCir: stats.gmv > 0 ? (stats.cost / stats.gmv) * 100 : 0,
            productCount: stats.products.size,
            videoCount: stats.videos.length,
            videos: stats.videos,
            effectiveVideoCount,
            topProduct
        };
    });
  });

  kocsByProduct = computed(() => {
    const data = this.videoData(); // Uses KOC/Video data only
    const productKocMap = new Map<string, Map<string, { 
      gmv: number; 
      cost: number; 
      videoRecords: TiktokAd[];
      clicks: number;
      impressions: number;
      weightedCvr: number;
    }>>();

    for (const row of data) {
      const productName = row.campaignName;
      if (!productKocMap.has(productName)) {
        productKocMap.set(productName, new Map());
      }
      const kocMap = productKocMap.get(productName)!;

      if (!kocMap.has(row.tiktokAccount)) {
        kocMap.set(row.tiktokAccount, { gmv: 0, cost: 0, videoRecords: [], clicks: 0, impressions: 0, weightedCvr: 0 });
      }
      const kocStats = kocMap.get(row.tiktokAccount)!;
      kocStats.gmv += row.gmv;
      kocStats.cost += row.cost;
      kocStats.videoRecords.push(row);
      kocStats.clicks += row.clicks;
      kocStats.impressions += row.impressions;
      kocStats.weightedCvr += row.clicks * row.cvr;
    }

    const result = new Map<string, { 
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
    }[]>();

    for (const [productName, kocMap] of productKocMap.entries()) {
      const kocArray = Array.from(kocMap.entries()).map(([kocName, stats]) => ({
        kocName,
        totalGmv: stats.gmv,
        totalCost: stats.cost,
        videoCount: stats.videoRecords.length,
        videos: stats.videoRecords,
        avgRoi: stats.cost > 0 ? stats.gmv / stats.cost : 0,
        avgCir: stats.gmv > 0 ? (stats.cost / stats.gmv) * 100 : 0,
        avgCpc: stats.clicks > 0 ? stats.cost / stats.clicks : 0,
        avgCtr: stats.impressions > 0 ? (stats.clicks / stats.impressions) * 100 : 0,
        avgCvr: stats.clicks > 0 ? stats.weightedCvr / stats.clicks : 0,
      }));
      result.set(productName, kocArray);
    }

    return result;
  });

  loadData(data: TiktokAd[], fileName: string) {
    // 1. Clean data (Normalize)
    const sanitizedData = data.map(ad => ({
      ...ad,
      tiktokAccount: (ad.tiktokAccount || 'Unknown').toLowerCase().trim()
    }));
  
    // 2. Set data into Signal (Important: This must run first for the app to have data)
    this.rawData.set(sanitizedData);
    this.fileName.set(fileName);
    this.error.set(null);
  
    // 3. Safe Cache
    try {
      // Only save the first 1000 rows to avoid quota issues
      const CACHE_LIMIT = 1000; 
      const dataToCache = sanitizedData.slice(0, CACHE_LIMIT);
      
      const cache = {
        fileName: fileName,
        data: JSON.stringify(dataToCache),
        isTruncated: sanitizedData.length > CACHE_LIMIT
      };
      localStorage.setItem(DATA_CACHE_KEY, JSON.stringify(cache));
      
      if (sanitizedData.length > CACHE_LIMIT) {
        console.warn(`File is large (${sanitizedData.length} rows). Caching only the first ${CACHE_LIMIT} rows to save memory.`);
      }
    } catch (e) {
      // Catch Quota Exceeded error and fail gracefully
      console.warn("LocalStorage is full. The app will run normally but will not be cached for the next session.");
      // Clear old cache to free up memory
      try { localStorage.removeItem(DATA_CACHE_KEY); } catch(err) {} 
    }
  }

  setError(message: string) {
    this.error.set(message);
    this.rawData.set([]);
    this.fileName.set('');
  }

  reset() {
    this.rawData.set([]);
    this.fileName.set('');
    this.error.set(null);
    localStorage.removeItem(DATA_CACHE_KEY);
  }
}