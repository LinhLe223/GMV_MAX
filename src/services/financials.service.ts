

import { Injectable, signal, computed, inject } from '@angular/core';
import * as XLSX from 'xlsx';
import { OrderData, InventoryData, KocPnlData, EnrichedOrderData, ProductPnlData } from '../models/financial.model';
import { DataService, KocReportStat } from './data.service';
import { TiktokAd } from '../models/tiktok-ad.model';

export interface DebugInfo {
  orderFileColumns?: string[];
  inventoryFileColumns?: string[];
  adsFileColumns?: string[];
  errorContext?: string;
}

export interface PnlDebugStats {
  totalOrders: number;
  cogsFoundCount: number;
}

const fileTypeKeywords = {
  ads: ["Chi phí", "Doanh thu gộp", "Tài khoản TikTok", "Cost", "GMV"],
  order: ["ID đơn hàng", "Order ID", "Tên người dùng nhà sáng tạo", "Sku người bán"],
  inventory: ["Mã SKU", "SKU", "Toàn bộ kho khả dụng", "Giá vốn"]
};

@Injectable({
  providedIn: 'root',
})
export class FinancialsService {
  private dataService = inject(DataService);

  orderData = signal<OrderData[]>([]);
  inventoryData = signal<InventoryData[]>([]);
  kocPnlData = signal<KocPnlData[]>([]);
  ordersWithCogsByKoc = signal<Map<string, EnrichedOrderData[]>>(new Map());
  
  error = signal<string | null>(null);
  debugInfo = signal<DebugInfo | null>(null);
  pnlDebugStats = signal<PnlDebugStats | null>(null);
  isLoading = signal(false);
  
  financialsLoaded = computed(() => this.orderData().length > 0 && this.inventoryData().length > 0 && this.kocPnlData().length > 0);
  
  unmappedKocs = signal<KocReportStat[]>([]);
  notFoundSkus = signal<string[]>([]);

  private normalizeKoc(str: string): string {
    if (!str) return 'unknown';
    const suffixesToRemove = ['review', 'official', 'store', 'channel'];
    let normalized = str
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // remove accents
      .replace(/đ/g, "d")
      .replace(/[^a-z0-9]/g, ''); // remove non-alphanumeric

    suffixesToRemove.forEach(suffix => {
        if (normalized.endsWith(suffix)) {
            normalized = normalized.slice(0, -suffix.length);
        }
    });

    return normalized || 'unknown';
  }

  private normalizeName(str: string): string {
     if (!str) return '';
      return str
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d");
  }

  async processAndLoadAdsFile(file: File): Promise<void> {
    try {
      const rawData = await this.smartReadFile(file, 'ads');
      const parsedData = rawData.map(row => this.mapAdsData(row));
      
      if (parsedData.length === 0) {
        throw new Error("File quảng cáo không có dữ liệu hoặc không đúng cấu trúc cột.");
      } else {
        this.dataService.loadData(parsedData, file.name);
      }
    } catch(e) {
      this.dataService.setError((e as Error).message);
      throw e; 
    }
  }

  async processPnlFiles(orderFile: File, inventoryFile: File): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);
    this.debugInfo.set(null);
    this.pnlDebugStats.set(null);
    this.notFoundSkus.set([]);
    this.ordersWithCogsByKoc.set(new Map());

    try {
      const [orders, inventory] = await Promise.all([
        this.smartReadFile<OrderData>(orderFile, 'order', this.mapOrderData),
        this.smartReadFile<InventoryData>(inventoryFile, 'inventory', this.mapInventoryData)
      ]);
      
      this.orderData.set(orders);
      this.inventoryData.set(inventory);

      this.calculatePnl();

    } catch (e) {
      this.error.set((e as Error).message);
      this.resetPartial(); // Reset only PNL data, keep Ads data
      throw e;
    } finally {
      this.isLoading.set(false);
    }
  }

  private findCogs(order: OrderData, inventorySkuMap: Map<string, InventoryData[]>, inventoryNameMap: Map<string, InventoryData[]>): number {
    const orderSkuClean = (order.seller_sku || '').toLowerCase().trim();
    const productNameClean = this.normalizeName(order.product_name || '');
    
    if (!orderSkuClean && !productNameClean) return 0;

    // Step 1: Exact SKU match
    if (orderSkuClean) {
        const exactMatch = inventorySkuMap.get(orderSkuClean);
        if (exactMatch && exactMatch.length > 0) {
            return exactMatch[0].cogs;
        }
    }
    
    // Step 2: Partial SKU match (inv_sku is inside order_sku)
    if (orderSkuClean) {
        for (const [invSku, invItems] of inventorySkuMap.entries()) {
            if (invSku && orderSkuClean.includes(invSku)) { // Ensure invSku is not empty
                return invItems[0].cogs;
            }
        }
    }

    // Step 3: Name match (inv_name is inside product_name)
    if (productNameClean) {
        for (const [invName, invItems] of inventoryNameMap.entries()) {
            if (invName && productNameClean.includes(invName)) { // Ensure invName is not empty
                return invItems[0].cogs;
            }
        }
    }
    
    return 0; // Not found
  }

  private calculatePnl(): void {
    const adsKocStats = this.dataService.kocReportStats();
    if (adsKocStats.length === 0) {
      throw new Error("Dữ liệu quảng cáo (Ads Data) chưa được tải. Vui lòng tải file ở trang Tổng quan trước.");
    }
    
    const adsKocMap = new Map<string, KocReportStat>(adsKocStats.map(koc => [this.normalizeKoc(koc.name), koc]));

    const inventorySkuMap = new Map<string, InventoryData[]>();
    this.inventoryData().forEach(item => {
        const key = (item.inventory_sku || '').toLowerCase().trim();
        if (key) {
            if (!inventorySkuMap.has(key)) inventorySkuMap.set(key, []);
            inventorySkuMap.get(key)!.push(item);
        }
    });

    const inventoryNameMap = new Map<string, InventoryData[]>();
    this.inventoryData().forEach(item => {
        const key = this.normalizeName(item.name || '');
        if (key) {
            if (!inventoryNameMap.has(key)) inventoryNameMap.set(key, []);
            inventoryNameMap.get(key)!.push(item);
        }
    });
    
    const ordersByKoc = new Map<string, OrderData[]>();
    this.orderData().forEach(order => {
        const kocName = this.normalizeKoc(order.koc_username || 'Organic/Khác');
        if(!ordersByKoc.has(kocName)) ordersByKoc.set(kocName, []);
        ordersByKoc.get(kocName)!.push(order);
    });

    const pnlByKoc = new Map<string, Omit<KocPnlData, 'kocName' | 'normalizedKocName' | 'adsCost' | 'adsGmv' | 'netProfit' | 'suggestion' | 'suggestionColor'>>();
    const enrichedOrdersByKoc = new Map<string, EnrichedOrderData[]>();
    
    const failedStatus = ['đã hủy', 'đã đóng', 'thất bại'];
    const refundKeywords = ['hoàn tiền'];
    const notFoundSkus = new Set<string>();

    let cogsFoundCount = 0;

    for (const [kocKey, orders] of ordersByKoc.entries()) {
        let totalGmv = 0, nmv = 0, totalCommission = 0, totalCogs = 0, failedOrders = 0;
        let topRevenueOrder: OrderData | null = null;
        const enrichedOrders: EnrichedOrderData[] = [];

        orders.forEach(order => {
            totalGmv += order.revenue;
            
            const status = (order.status || '').toLowerCase();
            const returnStatus = (order.return_status || '').toLowerCase();
            const isReal = !failedStatus.some(s => status.includes(s)) && !refundKeywords.some(kw => returnStatus.includes(kw));

            const cogsPerUnit = this.findCogs(order, inventorySkuMap, inventoryNameMap);
            const cogsForItem = cogsPerUnit * order.quantity;

            if (isReal) {
                nmv += order.revenue;
                totalCommission += order.commission;
                totalCogs += cogsForItem;
                
                if (cogsPerUnit > 0) {
                    cogsFoundCount++;
                } else if(order.seller_sku) {
                    notFoundSkus.add(order.seller_sku);
                }

                if (!topRevenueOrder || order.revenue > topRevenueOrder.revenue) {
                    topRevenueOrder = order;
                }
            } else {
                failedOrders++;
            }
            
            enrichedOrders.push({
              order_id: order.order_id,
              product_id: order.product_id,
              product_name: order.product_name,
              status: order.status,
              revenue: order.revenue,
              cogs: cogsForItem,
              grossProfit: order.revenue - cogsForItem,
              videoId: order.video_id,
              commission: order.commission,
            });
        });
        
        enrichedOrdersByKoc.set(kocKey, enrichedOrders);
        
        let latestVideoLink = '';
        if (topRevenueOrder && topRevenueOrder.koc_username && topRevenueOrder.video_id) {
            latestVideoLink = `https://www.tiktok.com/@${topRevenueOrder.koc_username}/video/${topRevenueOrder.video_id}`;
        }

        pnlByKoc.set(kocKey, {
            totalGmv, nmv, totalCommission, totalCogs, 
            totalOrders: orders.length, failedOrders,
            returnCancelPercent: orders.length > 0 ? (failedOrders / orders.length) * 100 : 0,
            latestVideoLink: latestVideoLink,
        });
    }
    
    this.pnlDebugStats.set({ totalOrders: this.orderData().length, cogsFoundCount });
    this.notFoundSkus.set(Array.from(notFoundSkus));
    this.ordersWithCogsByKoc.set(enrichedOrdersByKoc);

    const finalPnlData: KocPnlData[] = [];
    const localUnmappedKocs: KocReportStat[] = [];
    const totalAdsGmv = this.dataService.summaryStats().totalGmv;
    const allKocKeys: Set<string> = new Set([...adsKocMap.keys(), ...pnlByKoc.keys()]);

    for (const normalizedKoc of allKocKeys) {
        const adsData = adsKocMap.get(normalizedKoc);
        const pnlData = pnlByKoc.get(normalizedKoc);

        if (adsData && !pnlData && adsData.totalGmv > (totalAdsGmv * 0.005)) {
             localUnmappedKocs.push(adsData);
        }

        const originalKocName = adsData?.name || ordersByKoc.get(normalizedKoc)?.[0]?.koc_username || normalizedKoc;
        const adsCost = adsData?.totalCost || 0;
        const netProfit = (pnlData?.nmv || 0) - (pnlData?.totalCogs || 0) - (pnlData?.totalCommission || 0) - adsCost;

        let suggestion = '';
        let suggestionColor = '';

        if (netProfit > 1000000 && adsCost > 1000000) {
            suggestion = 'SCALE';
            suggestionColor = 'bg-green-100 text-green-800';
        } else if (netProfit < 0 && adsCost > 2000000) {
            suggestion = 'CUT';
            suggestionColor = 'bg-red-100 text-red-800';
        } else if ((pnlData?.returnCancelPercent || 0) > 30) {
            suggestion = 'ALERT';
            suggestionColor = 'bg-yellow-100 text-yellow-800';
        }

        finalPnlData.push({
            kocName: originalKocName,
            normalizedKocName: normalizedKoc,
            adsCost: adsCost,
            adsGmv: adsData?.totalGmv || 0,
            totalGmv: pnlData?.totalGmv || 0,
            nmv: pnlData?.nmv || 0,
            totalCommission: pnlData?.totalCommission || 0,
            totalCogs: pnlData?.totalCogs || 0,
            netProfit,
            returnCancelPercent: pnlData?.returnCancelPercent || 0,
            totalOrders: pnlData?.totalOrders || 0,
            failedOrders: pnlData?.failedOrders || 0,
            latestVideoLink: pnlData?.latestVideoLink || '',
            suggestion,
            suggestionColor,
        });
    }

    this.kocPnlData.set(finalPnlData);
    this.unmappedKocs.set(localUnmappedKocs.sort((a,b) => b.totalGmv - a.totalGmv));
  }

  getKocOrders(kocKey: string): any[] {
    const allOrders = this.orderData();
    const inventory = this.inventoryData();
  
    if (allOrders.length === 0 || inventory.length === 0) return [];
    
    const inventorySkuMap = new Map<string, InventoryData[]>();
    inventory.forEach(item => {
        const key = (item.inventory_sku || '').toLowerCase().trim();
        if (key) {
            if (!inventorySkuMap.has(key)) inventorySkuMap.set(key, []);
            inventorySkuMap.get(key)!.push(item);
        }
    });
  
    const inventoryNameMap = new Map<string, InventoryData[]>();
    inventory.forEach(item => {
        const key = this.normalizeName(item.name || '');
        if (key) {
            if (!inventoryNameMap.has(key)) inventoryNameMap.set(key, []);
            inventoryNameMap.get(key)!.push(item);
        }
    });
  
    const orders = allOrders.filter(o => this.normalizeKoc(o.koc_username || 'Organic/Khác') === kocKey);
    
    return orders.map(o => {
      const cogs = this.findCogs(o, inventorySkuMap, inventoryNameMap) * (o.quantity || 1);
      
      const failedStatus = ['đã hủy', 'đã đóng', 'thất bại'];
      const refundKeywords = ['hoàn tiền'];
      const status = (o.status || '').toLowerCase();
      const returnStatus = (o.return_status || '').toLowerCase();
      const isReturn = failedStatus.some(s => status.includes(s)) || refundKeywords.some(kw => returnStatus.includes(kw));
  
      const nmv = isReturn ? 0 : (o.revenue || 0);
      const commission = o.commission || 0;
      const netProfit = nmv - cogs - commission;
      
      return {
        orderId: o.order_id,
        productName: o.product_name,
        status: o.status,
        quantity: o.quantity,
        price: o.revenue,
        cogs: cogs,
        commission: commission,
        netProfit: netProfit,
        isReturn: isReturn
      };
    });
  }

  dashboardMetrics = computed(() => {
    const pnlData = this.kocPnlData();
    if (pnlData.length === 0) {
        return { nmv: 0, returnRate: 0, cogs: 0, netProfit: 0, adsCost: 0 };
    }
    
    const totalOrders = pnlData.reduce((sum, koc) => sum + koc.totalOrders, 0);
    const totalFailedOrders = pnlData.reduce((sum, koc) => sum + koc.failedOrders, 0);

    const totalNmv = pnlData.reduce((sum, koc) => sum + koc.nmv, 0);
    const totalCogs = pnlData.reduce((sum, koc) => sum + koc.totalCogs, 0);
    const totalNetProfit = pnlData.reduce((sum, koc) => sum + koc.netProfit, 0);
    const totalAdsCost = this.dataService.summaryStats().totalCost;
    const totalReturnRate = totalOrders > 0 ? (totalFailedOrders / totalOrders) * 100 : 0;

    return {
      nmv: totalNmv,
      returnRate: totalReturnRate,
      cogs: totalCogs,
      netProfit: totalNetProfit,
      adsCost: totalAdsCost,
    };
  });
  
  costStructure = computed(() => {
    const pnlData = this.kocPnlData();
    if (pnlData.length === 0) return { ads: 0, cogs: 0, commission: 0, total: 1 };
    
    const totalAds = this.dataService.summaryStats().totalCost;
    const totalCogs = pnlData.reduce((sum, koc) => sum + koc.totalCogs, 0);
    const totalCommission = pnlData.reduce((sum, koc) => sum + koc.totalCommission, 0);
    const total = totalAds + totalCogs + totalCommission;

    return {
      ads: totalAds,
      cogs: totalCogs,
      commission: totalCommission,
      total: total > 0 ? total : 1,
    };
  });
  
  inventoryValue = computed(() => {
      const invData = this.inventoryData();
      const pnlMetrics = this.dashboardMetrics();
      if(invData.length === 0) return { totalValue: 0, totalCogs: 0};

      const totalValue = invData.reduce((sum, item) => sum + (item.stock * item.cogs), 0);
      return {
          totalValue,
          totalCogs: pnlMetrics.cogs
      }
  });

  private resetPartial(): void {
    this.orderData.set([]);
    this.inventoryData.set([]);
    this.kocPnlData.set([]);
    this.unmappedKocs.set([]);
    this.notFoundSkus.set([]);
    this.ordersWithCogsByKoc.set(new Map());
  }

  reset(): void {
    this.resetPartial();
    this.error.set(null);
    this.debugInfo.set(null);
    this.pnlDebugStats.set(null);
  }

  private async smartReadFile<T>(file: File, fileType: keyof typeof fileTypeKeywords, mapper: (row: any) => T): Promise<T[]>;
  private async smartReadFile(file: File, fileType: keyof typeof fileTypeKeywords): Promise<any[]>;
  private async smartReadFile<T>(file: File, fileType: keyof typeof fileTypeKeywords, mapper?: (row: any) => T): Promise<T[] | any[]> {
    const targetKeywords = fileTypeKeywords[fileType];

    try {
      const buffer = await file.arrayBuffer();
      const wb: XLSX.WorkBook = XLSX.read(buffer, { type: 'array' });
      const wsname: string = wb.SheetNames[0];
      const ws: XLSX.WorkSheet = wb.Sheets[wsname];

      const rowsPreview: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, range: 'A1:Z20' });
      let headerRowIndex = -1;
      for (let i = 0; i < rowsPreview.length; i++) {
        const row = rowsPreview[i];
        if (!row || row.length === 0) continue;
        const rowStr = row.map(cell => String(cell || '').toLowerCase()).join(' ');
        const matches = targetKeywords.some(kw => rowStr.includes(kw.toLowerCase()));
        if (matches) {
          headerRowIndex = i;
          break;
        }
      }

      if (headerRowIndex === -1) {
        this.debugInfo.update(d => ({...d, [`${fileType}FileColumns`]: (rowsPreview[0] || []).filter(h => h) }));
        throw new Error(`Không tìm thấy dòng tiêu đề hợp lệ trong file "${file.name}".`);
      }

      const rawData: any[] = XLSX.utils.sheet_to_json(ws, { header: headerRowIndex });

      const cleanedData = rawData.map(row => 
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [key.trim().replace(/\ufeff/g, ''), value])
        )
      );
      
      if (mapper) {
          return cleanedData.map(mapper.bind(this));
      }
      return cleanedData;

    } catch (error) {
        const err = error as Error;
        const message = `Lỗi xử lý file ${file.name}: ${err.message}`;
        this.debugInfo.update(d => ({...d, errorContext: message}));
        throw new Error(message);
    }
  }

  private mapAdsData(row: any): TiktokAd {
    const cost = this.parseNumber(row['Chi phí']);
    const gmv = this.parseNumber(row['Doanh thu gộp']);
    const clicks = this.parseNumber(row['Số lượt nhấp vào quảng cáo sản phẩm'] || row['Số lượt nhấp']);
    const impressions = this.parseNumber(row['Số lượt hiển thị quảng cáo sản phẩm'] || row['Số lượt hiển thị']);
    const orders = this.parseNumber(row['Đơn hàng (SKU)']);

    let tiktokAccountVal = row['Tài khoản TikTok'];
    if (!tiktokAccountVal || String(tiktokAccountVal).trim() === '-' || String(tiktokAccountVal).trim().toLowerCase() === 'không khả dụng') {
        tiktokAccountVal = 'Unknown';
    }
    
    const roiVal = this.parseNumber(row['ROI']);
    const costPerOrderVal = this.parseNumber(row['Chi phí cho mỗi đơn hàng'] || row['CPĐH']);

    return {
        campaignName: String(row['Tên chiến dịch'] || row['Chiến dịch'] || 'N/A'),
        productId: String(row['ID sản phẩm'] || 'N/A'),
        videoTitle: String(row['Tiêu đề video'] || 'N/A'),
        videoId: String(row['ID video'] || 'N/A'),
        tiktokAccount: String(tiktokAccountVal),
        creativeType: String(row['Loại nội dung sáng tạo'] || 'N/A'),
        cost: cost,
        gmv: gmv,
        roi: roiVal || (cost > 0 ? gmv/cost : 0),
        impressions: impressions,
        clicks: clicks,
        ctr: this.parseNumber(row['Tỷ lệ nhấp vào quảng cáo sản phẩm'] || row['CTR']),
        cvr: this.parseNumber(row['Tỷ lệ chuyển đổi quảng cáo'] || row['CVR']),
        orders: orders,
        costPerOrder: costPerOrderVal || (orders > 0 ? cost / orders : 0),
        videoViewRate2s: this.parseNumber(row['Tỷ lệ xem video quảng cáo trong 2 giây']),
        videoViewRate6s: this.parseNumber(row['Tỷ lệ xem video quảng cáo trong 6 giây']),
        videoViewRate25p: this.parseNumber(row['Tỷ lệ xem 25% thời lượng video quảng cáo']),
        videoViewRate50p: this.parseNumber(row['Tỷ lệ xem 50% thời lượng video quảng cáo']),
        videoViewRate75p: this.parseNumber(row['Tỷ lệ xem 75% thời lượng video quảng cáo']),
        videoViewRate100p: this.parseNumber(row['Tỷ lệ xem 100% thời lượng video quảng cáo']),
        cir: gmv > 0 ? (cost / gmv) * 100 : 0,
        cpc: clicks > 0 ? cost / clicks : 0,
    };
  }

  private mapOrderData(row: any): OrderData {
    return {
      order_id: String(row["ID đơn hàng"] || ''),
      product_id: String(row["ID sản phẩm"] || ''),
      product_name: String(row["Tên sản phẩm"] || ''),
      seller_sku: String(row["Sku người bán"] || ''),
      revenue: this.parseNumber(row["Payment Amount"]),
      koc_username: String(row["Tên người dùng nhà sáng tạo"] || ''),
      video_id: String(row["Id nội dung"] || ''),
      commission: this.parseNumber(row["Thanh toán hoa hồng thực tế"]),
      status: String(row["Trạng thái đơn hàng"] || ''),
      return_status: String(row["Trả hàng & hoàn tiền"] || ''),
      quantity: this.parseNumber(row["Số lượng"] || 1),
    };
  }

  private mapInventoryData(row: any): InventoryData {
    return {
        inventory_sku: String(row["Mã SKU"] || ''),
        stock: this.parseNumber(row["Toàn bộ kho khả dụng"]),
        cogs: this.parseNumber(row["Giá vốn"]),
        name: String(row["Tên"] || ''),
    };
  }

  private parseNumber(value: any): number {
    if (value == null || value === '' || value === '-') {
        return 0;
    }
    if (typeof value === 'number') {
        return value;
    }

    let strValue = String(value).trim().replace(/đ|₫|VND|%|\s/gi, '');
    if (!strValue) return 0;

    const hasComma = strValue.includes(',');
    const hasDot = strValue.includes('.');

    if (hasComma && hasDot) {
        if (strValue.lastIndexOf(',') > strValue.lastIndexOf('.')) {
            strValue = strValue.replace(/\./g, '').replace(',', '.');
        } else {
            strValue = strValue.replace(/,/g, '');
        }
    } 
    else if (hasComma) {
        const parts = strValue.split(',');
        if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
            strValue = strValue.replace(/,/g, '');
        } else {
            strValue = strValue.replace(',', '.');
        }
    } 
    else if (hasDot) {
        const parts = strValue.split('.');
        if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
            strValue = strValue.replace(/\./g, '');
        }
    }

    const num = parseFloat(strValue);
    return isNaN(num) ? 0 : num;
  }
  
  productPnlData = computed(() => this.calculateProductPnl());

  private calculateProductPnl(): ProductPnlData[] {
    const orders = this.orderData();
    const inventory = this.inventoryData();

    if (orders.length === 0 || inventory.length === 0) {
      return [];
    }

    // Prepare inventory maps for findCogs
    const inventorySkuMap = new Map<string, InventoryData[]>();
    inventory.forEach(item => {
        const key = (item.inventory_sku || '').toLowerCase().trim();
        if (key) {
            if (!inventorySkuMap.has(key)) inventorySkuMap.set(key, []);
            inventorySkuMap.get(key)!.push(item);
        }
    });

    const inventoryNameMap = new Map<string, InventoryData[]>();
    inventory.forEach(item => {
        const key = this.normalizeName(item.name || '');
        if (key) {
            if (!inventoryNameMap.has(key)) inventoryNameMap.set(key, []);
            inventoryNameMap.get(key)!.push(item);
        }
    });

    const productMap = new Map<string, Omit<ProductPnlData, 'netProfit' | 'returnRate'>>();

    orders.forEach(order => {
      const key = order.product_id || order.seller_sku;
      if (!key) return; // Skip orders without a product identifier

      if (!productMap.has(key)) {
        productMap.set(key, {
          productId: order.product_id,
          productName: order.product_name,
          sku: order.seller_sku,
          nmv: 0,
          gmv: 0,
          cogs: 0,
          commission: 0,
          adsCost: 0, // Hardcoded to 0 as mapping is complex
          returnCount: 0,
          successCount: 0,
          totalCount: 0
        });
      }

      const item = productMap.get(key)!;
      item.totalCount++;
      item.gmv += order.revenue || 0;

      const failedStatus = ['đã hủy', 'đã đóng', 'thất bại'];
      const refundKeywords = ['hoàn tiền'];
      const status = (order.status || '').toLowerCase();
      const returnStatus = (order.return_status || '').toLowerCase();
      const isReturn = failedStatus.some(s => status.includes(s)) || refundKeywords.some(kw => returnStatus.includes(kw));

      if (isReturn) {
        item.returnCount++;
      } else {
        item.successCount++;
        item.nmv += order.revenue || 0;
        item.commission += order.commission || 0;
        
        const skuCost = this.findCogs(order, inventorySkuMap, inventoryNameMap);
        item.cogs += (order.quantity || 1) * skuCost;
      }
    });

    return Array.from(productMap.values()).map(p => {
      const netProfit = p.nmv - p.cogs - p.commission - p.adsCost;
      const returnRate = p.totalCount > 0 ? (p.returnCount / p.totalCount) * 100 : 0;
      return {
        ...p,
        netProfit,
        returnRate
      };
    });
  }

  // New methods for GOD MODE V2
  calculateGodModeSummary(masterData: KocPnlData[]) {
    const summary = {
      totalRevenue: 0,      // Tổng doanh số (GMV)
      totalNMV: 0,          // Doanh thu thực (NMV)
      totalKoc: masterData.length,
      activeKoc: 0,         // KOC có đơn > 0
      totalAdsCost: 0,
      totalCOGS: 0,
      totalCommission: 0,
      totalNetProfit: 0,
      avgReturnRate: 0
    };

    let totalOrders = 0;
    let totalReturned = 0;

    masterData.forEach(item => {
      summary.totalRevenue += item.totalGmv; // Use totalGmv from order data
      summary.totalNMV += item.nmv;
      summary.totalAdsCost += item.adsCost;
      summary.totalCOGS += item.totalCogs;
      summary.totalCommission += item.totalCommission;
      summary.totalNetProfit += item.netProfit;
      
      if (item.totalOrders > 0) summary.activeKoc++;
      totalOrders += item.totalOrders;
      totalReturned += item.failedOrders;
    });

    summary.avgReturnRate = totalOrders > 0 ? (totalReturned / totalOrders) * 100 : 0;
    return summary;
  }

  classifyBCG(koc: KocPnlData, avgGMV: number, avgProfit: number): string {
    // Trục tung: Lợi nhuận (Profit) | Trục hoành: Thị phần (GMV)
    const highGMV = koc.totalGmv >= avgGMV;
    const highProfit = koc.netProfit >= avgProfit;

    if (highGMV && highProfit) return 'STAR';       // ⭐ Ngôi sao (Vít mạnh)
    if (highGMV && !highProfit) return 'COW';       // 🐮 Bò sữa (Cần tối ưu chi phí)
    if (!highGMV && highProfit) return 'QUESTION';  // ❓ Dấu hỏi (Tiềm năng, cần đẩy Ads)
    return 'DOG';                                   // 🐕 Chó mực (Cắt bỏ)
  }
}