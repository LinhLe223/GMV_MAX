import { Injectable, signal, computed, inject } from '@angular/core';
import * as XLSX from 'xlsx';
import { OrderData, InventoryData, KocPnlData, EnrichedOrderData, ProductPnlData, KocDetailItem, GodModeItem, CostStructure, KocOrderItemDetail } from '../models/financial.model';
import { DataService, KocReportStat } from './data.service';
import { TiktokAd } from '../models/tiktok-ad.model';
import { EnterpriseService } from './enterprise.service';

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
  private enterpriseService = inject(EnterpriseService);

  // --- RAW DATA SIGNALS ---
  orderData = signal<OrderData[]>([]);
  inventoryData = signal<InventoryData[]>([]);
  
  // --- STATE & DEBUG SIGNALS ---
  error = signal<string | null>(null);
  debugInfo = signal<DebugInfo | null>(null);
  pnlDebugStats = signal<PnlDebugStats | null>(null);
  isLoading = signal(false);
  notFoundSkus = signal<string[]>([]);

  // --- DERIVED DATA & STATUS ---
  financialsLoaded = computed(() => this.orderData().length > 0 && this.inventoryData().length > 0 && this.godModeData().length > 0);

  // #region RESTORED/RE-IMPLEMENTED SERVICE MEMBERS
  // The following signals and methods were restored to fix "undefined is not a function" errors
  // in components like PnlReportComponent, SidebarComponent, and ChatbotComponent.
  
  /**
   * Central computed signal that merges Ads, Orders, and Inventory data.
   * This serves as the single source of truth for all P&L calculations.
   * Other public signals (godModeData, kocPnlData) are derived from this.
   */
  private masterPnlData = computed(() => {
    const adsData = this.dataService.rawData();
    const ordersData = this.orderData();
    const inventoryData = this.inventoryData();
    const costConfig = this.enterpriseService.getCostStructure();

    const kocMap = new Map<string, {
      kocName: string;
      mergeKey: string;
      adsCost: number;
      adsGmv: number;
      orderGmv: number;
      nmv: number;
      cogs: number;
      commission: number;
      totalOrders: number;
      returnCount: number;
    }>();

    // Step A: Process Ads
    adsData.forEach(ad => {
      const key = this.normalizeKocName(ad.tiktokAccount);
      if (!kocMap.has(key)) {
        kocMap.set(key, {
          kocName: ad.tiktokAccount, mergeKey: key, adsCost: 0, adsGmv: 0,
          orderGmv: 0, nmv: 0, cogs: 0, commission: 0, totalOrders: 0, returnCount: 0
        });
      }
      const item = kocMap.get(key)!;
      item.adsCost += ad.cost || 0;
      item.adsGmv += ad.gmv || 0;
    });

    // Step B: Process Orders
    ordersData.forEach(order => {
      const key = this.normalizeKocName(order.koc_username);
      if (!key) return;
      if (!kocMap.has(key)) {
        kocMap.set(key, {
          kocName: order.koc_username || key, mergeKey: key, adsCost: 0, adsGmv: 0,
          orderGmv: 0, nmv: 0, cogs: 0, commission: 0, totalOrders: 0, returnCount: 0
        });
      }
      
      const item = kocMap.get(key)!;
      item.totalOrders++;
      item.orderGmv += order.revenue || 0; // Aggregate GMV from all orders

      const isReturn = ['Đã hủy', 'Đã đóng', 'Thất bại'].includes(order.status) || (order.return_status && order.return_status.includes('Hoàn tiền'));
      
      if (isReturn) {
        item.returnCount++;
      } else {
        item.nmv += order.revenue || 0;
        item.commission += order.commission || 0;
        const unitCogs = this.findCogs(order.seller_sku, order.product_name, inventoryData);
        item.cogs += (order.quantity || 1) * unitCogs;
      }
    });

    // Step C: Calculate final metrics for each KOC
    return Array.from(kocMap.values()).map(item => {
      const platformFee = item.nmv * ((costConfig?.platformFeePercent || 0) / 100);
      let opsFee = 0;
      if(costConfig?.operatingFee?.type === 'fixed') {
        opsFee = item.totalOrders * (costConfig.operatingFee.value || 0);
      } else if (costConfig?.operatingFee?.type === 'percent') {
        opsFee = item.nmv * ((costConfig.operatingFee.value || 0) / 100);
      }
      
      const netProfit = item.nmv - item.cogs - item.commission - item.adsCost - platformFee - opsFee;
      const realRoas = item.adsCost > 0 ? item.nmv / item.adsCost : 0;
      const returnRate = item.totalOrders > 0 ? (item.returnCount / item.totalOrders) * 100 : 0;
      
      const grossProfitAfterFees = item.nmv - (item.cogs + item.commission + platformFee + opsFee);
      const breakEvenRoas = grossProfitAfterFees > 0 ? item.nmv / grossProfitAfterFees : Infinity;
      
      let healthStatus: KocPnlData['healthStatus'] = 'NEUTRAL';
      if (netProfit < 0) healthStatus = 'BLEEDING';
      else if (realRoas > breakEvenRoas && netProfit > 0) healthStatus = 'HEALTHY';
      
      return { ...item, netProfit, realRoas, returnRate, breakEvenRoas, healthStatus };
    });
  });

  /**
   * RESTORED: Data for the GodModeComponent.
   */
  godModeData = computed<GodModeItem[]>(() => {
    return this.masterPnlData().map(item => ({
        kocName: item.kocName,
        mergeKey: item.mergeKey,
        adsCost: item.adsCost,
        gmv: item.adsGmv, // In God Mode, GMV refers to the value from the Ads file
        nmv: item.nmv,
        commission: item.commission,
        totalOrders: item.totalOrders,
        returnCount: item.returnCount,
        cogs: item.cogs,
        netProfit: item.netProfit,
        realRoas: item.realRoas,
        returnRate: item.returnRate,
    }));
  });

  /**
   * RESTORED: Richer P&L data structure for PnlReportComponent and Chatbot.
   */
  kocPnlData = computed<KocPnlData[]>(() => {
      return this.masterPnlData().map(item => ({
        kocName: item.kocName,
        normalizedKocName: item.mergeKey,
        adsCost: item.adsCost,
        adsGmv: item.adsGmv,
        realRoas: item.realRoas,
        totalGmv: item.orderGmv,
        nmv: item.nmv,
        totalCommission: item.commission,
        totalCogs: item.cogs,
        grossProfit: item.nmv - item.cogs - item.commission,
        netProfit: item.netProfit,
        returnCancelPercent: item.returnRate,
        totalOrders: item.totalOrders,
        successOrders: item.totalOrders - item.returnCount,
        failedOrders: item.returnCount,
        latestVideoLink: '', // This remains difficult to compute here.
        breakEvenRoas: item.breakEvenRoas,
        daysOnHand: 0, // Placeholder
        daysOnHandDisplay: 'N/A', // Placeholder
        stockQuantity: 0, // Placeholder
        healthStatus: item.healthStatus,
        aiCommand: '', // Placeholder
      }));
  });
  
  /**
   * RESTORED: High-level metrics for the P&L dashboard.
   */
  dashboardMetrics = computed(() => {
    const pnlData = this.kocPnlData();
    if (pnlData.length === 0) {
      return { nmv: 0, returnRate: 0, cogs: 0, netProfit: 0 };
    }
    const totalNMV = pnlData.reduce((sum, k) => sum + k.nmv, 0);
    const totalOrders = pnlData.reduce((sum, k) => sum + k.totalOrders, 0);
    const totalFailed = pnlData.reduce((sum, k) => sum + k.failedOrders, 0);
    return {
        nmv: totalNMV,
        returnRate: totalOrders > 0 ? (totalFailed / totalOrders) * 100 : 0,
        cogs: pnlData.reduce((sum, k) => sum + k.totalCogs, 0),
        netProfit: pnlData.reduce((sum, k) => sum + k.netProfit, 0)
    };
  });

  /**
   * RESTORED: Cost breakdown for the P&L dashboard.
   */
  costStructure = computed(() => {
    const pnlData = this.kocPnlData();
    const ads = pnlData.reduce((s, k) => s + k.adsCost, 0);
    const cogs = pnlData.reduce((s, k) => s + k.totalCogs, 0);
    const commission = pnlData.reduce((s, k) => s + k.totalCommission, 0);
    const total = ads + cogs + commission;
    return { ads, cogs, commission, total };
  });

  /**
   * RESTORED: Inventory value metrics for the P&L dashboard.
   */
  inventoryValue = computed(() => {
    const invData = this.inventoryData();
    const pnlData = this.kocPnlData();
    return {
        totalValue: invData.reduce((s, i) => s + (i.stock * i.cogs), 0),
        totalCogs: pnlData.reduce((s, k) => s + k.totalCogs, 0)
    };
  });
  
  /**
   * RESTORED: KOCs from Ads file not found in Orders file. Used in Sidebar.
   */
  unmappedKocs = computed<KocReportStat[]>(() => {
    const adsKocs = this.dataService.kocReportStats();
    if (this.orderData().length === 0 || adsKocs.length === 0) {
      return [];
    }
    const orderKocNames = new Set(this.orderData().map(o => this.normalizeKocName(o.koc_username)));
    
    return adsKocs
        .filter(koc => koc.totalGmv > 0 && !orderKocNames.has(this.normalizeKocName(koc.name)))
        .sort((a,b) => b.totalGmv - a.totalGmv);
  });

  /**
   * RESTORED: Gets enriched order details for a KOC. Used in PnlReportComponent drill-down.
   */
  getKocOrders(normalizedKocName: string): any[] {
    const orders = this.orderData().filter(o => this.normalizeKocName(o.koc_username) === normalizedKocName);
    const inventory = this.inventoryData();
    
    return orders.map(o => {
        const isReturn = ['Đã hủy', 'Đã đóng', 'Thất bại'].includes(o.status) || (o.return_status && o.return_status.includes('Hoàn tiền'));
        const revenue = isReturn ? 0 : o.revenue;
        const cogs = isReturn ? 0 : this.findCogs(o.seller_sku, o.product_name, inventory) * (o.quantity || 1);
        const commission = isReturn ? 0 : o.commission;
        const netProfit = revenue - cogs - commission;
        return {
            orderId: o.order_id,
            productName: o.product_name,
            quantity: o.quantity,
            price: revenue,
            cogs,
            commission,
            netProfit,
            status: o.status,
            isReturn
        };
    });
  }

  // #endregion

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

    try {
      const [orders, inventory] = await Promise.all([
        this.smartReadFile<OrderData>(orderFile, 'order', this.mapOrderData),
        this.smartReadFile<InventoryData>(inventoryFile, 'inventory', this.mapInventoryData)
      ]);
      
      this.orderData.set(orders);
      this.inventoryData.set(inventory);
      
      // Trigger calculation. The computed signals will do the rest.
      // This is now just a trigger; the logic is inside the 'masterPnlData' computed signal.
      if (this.dataService.rawData().length === 0) {
          throw new Error("Dữ liệu quảng cáo (Ads Data) chưa được tải. Vui lòng tải file ở trang Tổng quan trước.");
      }

    } catch (e) {
      this.error.set((e as Error).message);
      this.resetPartial(); // Reset only PNL data, keep Ads data
      throw e;
    } finally {
      this.isLoading.set(false);
    }
  }

  private findCogs(orderSku: string, productName: string, inventory: InventoryData[]): number {
    const orderSkuClean = (orderSku || '').toLowerCase().trim();
    const productNameClean = (productName || '').toLowerCase();
  
    // Priority 1: Exact SKU match
    const exactMatch = inventory.find(i => (i.inventory_sku || '').toLowerCase().trim() === orderSkuClean);
    if (exactMatch) return exactMatch.cogs;
  
    // Priority 2: Fuzzy Name match
    const nameMatch = inventory.find(i => i.name && productNameClean.includes(i.name.toLowerCase()));
    return nameMatch ? nameMatch.cogs : 0;
  }

  /**
   * This is the original function from the prompt, adapted to be used with the new signal-based architecture.
   * It is no longer directly called to set a signal, but its logic is now inside the `masterPnlData` computed signal.
   * This function is kept for reference but is not directly used.
   */
  processMasterData(adsData: TiktokAd[], ordersData: OrderData[], inventoryData: InventoryData[], costConfig?: CostStructure): any[] {
     // This logic has been moved into the masterPnlData computed signal.
     // Kept for historical reference.
     return [];
  }

  /**
   * RESTORED: This function is required by GodModeComponent for its drill-down feature.
   */
  getKocDetails(mergeKey: string, allOrders: OrderData[], inventory: InventoryData[]): KocOrderItemDetail[] {
    const orders = allOrders.filter(o => this.normalizeKocName(o.koc_username) === mergeKey);
    
    return orders.map(o => {
      const isReturn = ['Đã hủy', 'Đã đóng'].includes(o.status);
      const revenue = isReturn ? 0 : (o.revenue || 0);
      const cogs = isReturn ? 0 : (this.findCogs(o.seller_sku, o.product_name, inventory) * (o.quantity || 1));
      
      return {
        orderId: o.order_id,
        productName: o.product_name,
        sku: o.seller_sku,
        videoId: o.video_id,
        revenue: revenue,
        cogs: cogs,
        commission: o.commission || 0,
        profit: revenue - cogs - (o.commission || 0),
        status: o.status,
        isReturn: isReturn
      };
    });
  }
  
  /**
   * RESTORED: Required by GodModeComponent for its summary view.
   */
  calculateGodModeSummary(masterData: GodModeItem[]): any {
    if (masterData.length === 0) {
      return { totalNMV: 0, totalRevenue: 0, totalNetProfit: 0, totalAdsCost: 0, totalCOGS: 0, activeKoc: 0, totalKoc: 0, avgReturnRate: 0 };
    }
    const summary = masterData.reduce((acc, item) => {
      acc.totalNMV += item.nmv || 0;
      acc.totalRevenue += item.gmv || 0; // In GodMode, 'gmv' is adsGmv
      acc.totalNetProfit += item.netProfit || 0;
      acc.totalAdsCost += item.adsCost || 0;
      acc.totalCOGS += item.cogs || 0;
      acc.totalReturnCount += item.returnCount || 0;
      acc.totalOrders += item.totalOrders || 0;
      if (item.netProfit > 0) {
        acc.activeKoc++;
      }
      return acc;
    }, { totalNMV: 0, totalRevenue: 0, totalNetProfit: 0, totalAdsCost: 0, totalCOGS: 0, activeKoc: 0, totalReturnCount: 0, totalOrders: 0 });

    return {
      ...summary,
      totalKoc: masterData.length,
      avgReturnRate: summary.totalOrders > 0 ? (summary.totalReturnCount / summary.totalOrders) * 100 : 0
    };
  }

  /**
   * RESTORED: Required by GodModeComponent for BCG matrix classification.
   */
  classifyBCG(koc: GodModeItem, avgGmv: number, avgProfit: number): 'STAR' | 'COW' | 'QUESTION' | 'DOG' {
    const isHighGmv = koc.gmv >= avgGmv; // GMV from ads
    const isHighProfit = koc.netProfit >= avgProfit;

    if (isHighProfit && isHighGmv) return 'STAR';
    if (!isHighProfit && isHighGmv) return 'COW';
    if (isHighProfit && !isHighGmv) return 'QUESTION';
    return 'DOG';
  }

  /**
   * The single, consolidated normalization function for KOC names.
   */
  private normalizeKocName(name: string): string {
    if (!name) return '';
    const suffixesToRemove = ['official', 'review', 'channel', 'store'];
    let normalized = name.toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/[^a-z0-9]/g, '');

    suffixesToRemove.forEach(suffix => {
        if (normalized.endsWith(suffix)) {
            normalized = normalized.slice(0, -suffix.length);
        }
    });
    
    return normalized;
  }

  private resetPartial(): void {
    this.orderData.set([]);
    this.inventoryData.set([]);
    this.notFoundSkus.set([]);
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
}