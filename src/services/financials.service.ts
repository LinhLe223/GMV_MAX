
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

  /**
   * Central computed signal that merges Ads, Orders, and Inventory data.
   * This serves as the single source of truth for all P&L calculations.
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
      item.orderGmv += order.revenue || 0;

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
      const successOrders = item.totalOrders - item.returnCount;
      if(costConfig?.operatingFee?.type === 'fixed') {
        opsFee = successOrders * (costConfig?.operatingFee?.value || 0);
      } else if (costConfig?.operatingFee?.type === 'percent') {
        opsFee = item.nmv * ((costConfig?.operatingFee?.value || 0) / 100);
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

  godModeData = computed<GodModeItem[]>(() => {
    return this.masterPnlData().map(item => ({
        kocName: item.kocName,
        mergeKey: item.mergeKey,
        adsCost: item.adsCost,
        gmv: item.adsGmv,
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
        latestVideoLink: '',
        breakEvenRoas: item.breakEvenRoas,
        daysOnHand: 0,
        daysOnHandDisplay: 'N/A',
        stockQuantity: 0,
        healthStatus: item.healthStatus,
        aiCommand: '',
      }));
  });

  productPnlData = computed<ProductPnlData[]>(() => {
    const ordersData = this.orderData();
    const inventoryData = this.inventoryData();
    const adsData = this.dataService.rawData();
    const costConfig = this.enterpriseService.getCostStructure();

    if (ordersData.length === 0) return [];

    const productMap = new Map<string, {
      productId: string; productName: string; skus: Set<string>;
      nmv: number; gmv: number; cogs: number; commission: number;
      returnCount: number; successCount: number; totalCount: number;
      adsCost: number; stock: number;
    }>();

    ordersData.forEach(order => {
      const key = order.product_name;
      if (!key) return;

      if (!productMap.has(key)) {
        productMap.set(key, {
          productId: order.product_id, productName: order.product_name, skus: new Set(),
          nmv: 0, gmv: 0, cogs: 0, commission: 0, returnCount: 0, successCount: 0,
          totalCount: 0, adsCost: 0, stock: 0
        });
      }

      const product = productMap.get(key)!;
      product.skus.add(order.seller_sku);
      product.totalCount++;
      product.gmv += order.revenue || 0;
      
      const isReturn = ['Đã hủy', 'Đã đóng', 'Thất bại'].includes(order.status) || (order.return_status && order.return_status.includes('Hoàn tiền'));
      if (isReturn) {
        product.returnCount++;
      } else {
        product.successCount++;
        product.nmv += order.revenue || 0;
        product.commission += order.commission || 0;
        const unitCogs = this.findCogs(order.seller_sku, order.product_name, inventoryData);
        product.cogs += (order.quantity || 1) * unitCogs;
      }
    });

    const adsCostByCampaign = adsData.reduce((acc, ad) => {
      acc[ad.campaignName] = (acc[ad.campaignName] || 0) + ad.cost;
      return acc;
    }, {} as Record<string, number>);

    productMap.forEach(product => {
      product.adsCost = adsCostByCampaign[product.productName] || 0;
      let totalStock = 0;
      product.skus.forEach(sku => {
        const invItem = inventoryData.find(i => i.inventory_sku === sku);
        if (invItem) totalStock += invItem.stock;
      });
      product.stock = totalStock;
    });

    return Array.from(productMap.values()).map(p => {
      const platformFee = p.nmv * ((costConfig?.platformFeePercent || 0) / 100);
      let opsFee = 0;
      if(costConfig?.operatingFee?.type === 'fixed') {
        opsFee = p.successCount * (costConfig?.operatingFee?.value || 0);
      } else if (costConfig?.operatingFee?.type === 'percent') {
        opsFee = p.nmv * ((costConfig?.operatingFee?.value || 0) / 100);
      }
      
      const grossProfit = p.nmv - p.cogs - p.commission - platformFee - opsFee;
      const netProfit = grossProfit - p.adsCost;
      const returnRate = p.totalCount > 0 ? (p.returnCount / p.totalCount) * 100 : 0;
      const realRoas = p.adsCost > 0 ? p.nmv / p.adsCost : 0;
      const breakEvenRoas = grossProfit > 0 ? p.nmv / grossProfit : Infinity;
      const avgDailySales = p.successCount / 30; 
      const daysOnHand = avgDailySales > 0 ? p.stock / avgDailySales : Infinity;
      
      let healthStatus: ProductPnlData['healthStatus'] = 'NEUTRAL';
      if (netProfit < 0) healthStatus = 'BLEEDING';
      else if (realRoas > breakEvenRoas && netProfit > 0) healthStatus = 'HEALTHY';
      
      let aiCommand: ProductPnlData['aiCommand'] = '';
      if (healthStatus === 'BLEEDING') aiCommand = 'KILL';
      if (healthStatus === 'HEALTHY') aiCommand = 'SCALE';
      if (daysOnHand < 7 && daysOnHand > 0) aiCommand = 'INVENTORY_ALERT';
      if (p.stock <= 0 && p.successCount > 0) aiCommand = 'STOCK_OUT';
      
      return {
        productId: p.productId, productName: p.productName, sku: Array.from(p.skus).join(', '),
        nmv: p.nmv, gmv: p.gmv, cogs: p.cogs, commission: p.commission, adsCost: p.adsCost,
        returnCount: p.returnCount, successCount: p.successCount, totalCount: p.totalCount,
        grossProfit, netProfit, returnRate, breakEvenRoas, realRoas,
        daysOnHand, daysOnHandDisplay: daysOnHand === Infinity ? '∞' : daysOnHand.toFixed(0),
        stockQuantity: p.stock, healthStatus, aiCommand
      };
    });
  });
  
  dashboardMetrics = computed(() => {
    const pnlData = this.kocPnlData();
    if (pnlData.length === 0) return { nmv: 0, returnRate: 0, cogs: 0, netProfit: 0 };
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

  costStructure = computed(() => {
    const pnlData = this.kocPnlData();
    const ads = pnlData.reduce((s, k) => s + k.adsCost, 0);
    const cogs = pnlData.reduce((s, k) => s + k.totalCogs, 0);
    const commission = pnlData.reduce((s, k) => s + k.totalCommission, 0);
    const total = ads + cogs + commission;
    if (total === 0) return { ads: 0, cogs: 0, commission: 0, total: 0 };
    return { ads, cogs, commission, total };
  });

  inventoryValue = computed(() => {
    return {
        totalValue: this.inventoryData().reduce((s, i) => s + (i.stock * i.cogs), 0),
        totalCogs: this.kocPnlData().reduce((s, k) => s + k.totalCogs, 0)
    };
  });
  
  unmappedKocs = computed<KocReportStat[]>(() => {
    const adsKocs = this.dataService.kocReportStats();
    if (this.orderData().length === 0 || adsKocs.length === 0) return [];
    const orderKocNames = new Set(this.orderData().map(o => this.normalizeKocName(o.koc_username)));
    return adsKocs
        .filter(koc => koc.totalGmv > 0 && !orderKocNames.has(this.normalizeKocName(koc.name)))
        .sort((a,b) => b.totalGmv - a.totalGmv);
  });

  getKocOrders(normalizedKocName: string): any[] {
    const orders = this.orderData().filter(o => this.normalizeKocName(o.koc_username) === normalizedKocName);
    const inventory = this.inventoryData();
    return orders.map(o => {
        const isReturn = ['Đã hủy', 'Đã đóng', 'Thất bại'].includes(o.status) || (o.return_status && o.return_status.includes('Hoàn tiền'));
        const revenue = isReturn ? 0 : o.revenue;
        const cogs = isReturn ? 0 : this.findCogs(o.seller_sku, o.product_name, inventory) * (o.quantity || 1);
        const commission = isReturn ? 0 : o.commission;
        return {
            orderId: o.order_id, productName: o.product_name, quantity: o.quantity,
            price: revenue, cogs, commission, netProfit: revenue - cogs - commission,
            status: o.status, isReturn
        };
    });
  }

  async processAndLoadAdsFile(file: File): Promise<void> {
    try {
      const rawData = await this.smartReadFile(file, 'ads');
      const parsedData = rawData.map(row => this.mapAdsData(row));
      
      if (parsedData.length === 0) {
        throw new Error("File quảng cáo không có dữ liệu hoặc không đúng cấu trúc cột.");
      }
      this.dataService.loadData(parsedData, file.name);
    } catch(e) {
      this.dataService.setError((e as Error).message);
      throw e; 
    }
  }

  async processPnlFiles(orderFile: File, inventoryFile: File): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);
    try {
      const [orders, inventory] = await Promise.all([
        this.smartReadFile<OrderData>(orderFile, 'order', this.mapOrderData.bind(this)),
        this.smartReadFile<InventoryData>(inventoryFile, 'inventory', this.mapInventoryData.bind(this))
      ]);
      this.orderData.set(orders);
      this.inventoryData.set(inventory);
      if (this.dataService.rawData().length === 0) {
          console.warn("Chưa có dữ liệu Ads, nhưng vẫn load Order/Inventory.");
      }
    } catch (e) {
      this.error.set((e as Error).message);
      throw e;
    } finally {
      this.isLoading.set(false);
    }
  }

  private findCogs(orderSku: string, productName: string, inventory: InventoryData[]): number {
    const orderSkuClean = (orderSku || '').toLowerCase().trim();
    const productNameClean = (productName || '').toLowerCase();
  
    const exactMatch = inventory.find(i => (i.inventory_sku || '').toLowerCase().trim() === orderSkuClean);
    if (exactMatch) return exactMatch.cogs;
  
    const nameMatch = inventory.find(i => {
       const invName = (i.name || '').toLowerCase().trim();
       return invName.length > 3 && productNameClean.includes(invName);
    });
    return nameMatch ? nameMatch.cogs : 0;
  }

  getKocDetails(mergeKey: string, allOrders: OrderData[], inventory: InventoryData[]): KocOrderItemDetail[] {
    const orders = allOrders.filter(o => this.normalizeKocName(o.koc_username) === mergeKey);
    return orders.map(o => {
      const isReturn = ['Đã hủy', 'Đã đóng'].includes(o.status);
      const revenue = isReturn ? 0 : (o.revenue || 0);
      const cogs = isReturn ? 0 : (this.findCogs(o.seller_sku, o.product_name, inventory) * (o.quantity || 1));
      return {
        orderId: o.order_id, productName: o.product_name, sku: o.seller_sku, videoId: o.video_id,
        revenue, cogs, commission: o.commission || 0, profit: revenue - cogs - (o.commission || 0),
        status: o.status, isReturn: isReturn
      };
    });
  }
  
  calculateGodModeSummary(masterData: GodModeItem[]): any {
    if (masterData.length === 0) return { totalNMV: 0, totalRevenue: 0, totalNetProfit: 0, totalAdsCost: 0, totalCOGS: 0, activeKoc: 0, totalKoc: 0, avgReturnRate: 0 };
    const summary = masterData.reduce((acc, item) => {
      acc.totalNMV += item.nmv || 0;
      acc.totalRevenue += item.gmv || 0;
      acc.totalNetProfit += item.netProfit || 0;
      acc.totalAdsCost += item.adsCost || 0;
      acc.totalCOGS += item.cogs || 0;
      acc.totalReturnCount += item.returnCount || 0;
      acc.totalOrders += item.totalOrders || 0;
      if (item.netProfit > 0) acc.activeKoc++;
      return acc;
    }, { totalNMV: 0, totalRevenue: 0, totalNetProfit: 0, totalAdsCost: 0, totalCOGS: 0, activeKoc: 0, totalReturnCount: 0, totalOrders: 0 });
    return {
      ...summary,
      totalKoc: masterData.length,
      avgReturnRate: summary.totalOrders > 0 ? (summary.totalReturnCount / summary.totalOrders) * 100 : 0
    };
  }

  classifyBCG(koc: GodModeItem, avgGmv: number, avgProfit: number): 'STAR' | 'COW' | 'QUESTION' | 'DOG' {
    const isHighGmv = koc.gmv >= avgGmv;
    const isHighProfit = koc.netProfit >= avgProfit;
    if (isHighGmv && isHighProfit) return 'STAR';
    if (isHighGmv && !isHighProfit) return 'COW';
    if (!isHighGmv && isHighProfit) return 'QUESTION';
    return 'DOG';
  }

  private normalizeKocName(name: string): string {
    if (!name) return '';
    const suffixes = ['official', 'review', 'channel', 'store'];
    let normalized = name.toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/[^a-z0-9]/g, '');
    suffixes.forEach(s => {
        if (normalized.endsWith(s)) normalized = normalized.slice(0, -s.length);
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
      const ws: XLSX.WorkBook['Sheets'][string] = wb.Sheets[wsname];
      const rowsPreview: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, range: 'A1:Z20' });
      let headerRowIndex = -1;
      for (let i = 0; i < rowsPreview.length; i++) {
        const row = rowsPreview[i];
        if (!row || row.length === 0) continue;
        const rowStr = row.map(cell => String(cell || '').toLowerCase()).join(' ');
        if (targetKeywords.some(kw => rowStr.includes(kw.toLowerCase()))) {
          headerRowIndex = i;
          break;
        }
      }
      if (headerRowIndex === -1) {
        throw new Error(`Không tìm thấy cột bắt buộc trong file "${file.name}". Hãy kiểm tra lại mẫu file.`);
      }
      const rawData: any[] = XLSX.utils.sheet_to_json(ws, { range: headerRowIndex });
      const cleanedData = rawData.map(row => 
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [key.trim().replace(/\ufeff/g, ''), value])
        )
      );
      if (mapper) return cleanedData.map(mapper);
      return cleanedData;
    } catch (error) {
        const err = error as Error;
        console.error(err);
        throw new Error(`Lỗi đọc file: ${err.message}`);
    }
  }

  private getRowValue(row: any, possibleKeys: string[]): any {
    const normalizedKeys = Object.keys(row).reduce((acc, key) => {
      acc[key.toLowerCase().trim()] = key;
      return acc;
    }, {} as Record<string, string>);
  
    for (const key of possibleKeys) {
      const foundKey = normalizedKeys[key.toLowerCase().trim()];
      if (foundKey && row[foundKey] != null && row[foundKey] !== '') {
        return row[foundKey];
      }
    }
    return null;
  }

  private mapAdsData(row: any): TiktokAd {
    const cols = {
      cost: ['Chi phí', 'Cost', 'Spend', 'Chi phi'],
      gmv: ['Doanh thu gộp', 'GMV', 'Gross Revenue', 'Doanh thu'],
      koc: ['Tài khoản TikTok', 'TikTok Account', 'Creator', 'User Name'],
      imp: ['Số lượt hiển thị', 'Impressions', 'Lượt xem'],
      click: ['Số lượt nhấp', 'Clicks', 'Lượt nhấp'],
      roi: ['ROI', 'Return on Ad Spend'],
      campaign: ['Tên chiến dịch', 'Campaign Name', 'Campaign'],
      product: ['ID sản phẩm', 'Product ID'],
      video: ['ID video', 'Video ID'],
      orders: ['Đơn hàng (SKU)', 'Orders'],
      ctr: ['CTR', 'Tỷ lệ nhấp'],
      cvr: ['CVR', 'Tỷ lệ chuyển đổi'],
      costPerOrder: ['Chi phí cho mỗi đơn hàng', 'CPĐH', 'Cost per Order'],
      videoViewRate2s: ['Tỷ lệ xem video quảng cáo trong 2 giây'],
      videoViewRate6s: ['Tỷ lệ xem video quảng cáo trong 6 giây'],
      videoViewRate25p: ['Tỷ lệ xem 25% thời lượng video quảng cáo'],
      videoViewRate50p: ['Tỷ lệ xem 50% thời lượng video quảng cáo'],
      videoViewRate75p: ['Tỷ lệ xem 75% thời lượng video quảng cáo'],
      videoViewRate100p: ['Tỷ lệ xem 100% thời lượng video quảng cáo'],
    };
  
    const cost = this.parseNumber(this.getRowValue(row, cols.cost));
    const gmv = this.parseNumber(this.getRowValue(row, cols.gmv));
    const clicks = this.parseNumber(this.getRowValue(row, cols.click));
    const impressions = this.parseNumber(this.getRowValue(row, cols.imp));
    const orders = this.parseNumber(this.getRowValue(row, cols.orders));
    let tiktokAccountVal = this.getRowValue(row, cols.koc);

    if (!tiktokAccountVal || String(tiktokAccountVal).trim() === '-' || String(tiktokAccountVal).trim().toLowerCase() === 'không khả dụng') {
      tiktokAccountVal = 'Unknown';
    }

    const roiVal = this.parseNumber(this.getRowValue(row, cols.roi));
    const costPerOrderVal = this.parseNumber(this.getRowValue(row, cols.costPerOrder));
  
    return {
      campaignName: String(this.getRowValue(row, cols.campaign) || 'N/A'),
      productId: String(this.getRowValue(row, cols.product) || 'N/A'),
      videoTitle: String(this.getRowValue(row, ['Tiêu đề video', 'Video Title']) || 'N/A'),
      videoId: String(this.getRowValue(row, cols.video) || 'N/A'),
      tiktokAccount: String(tiktokAccountVal),
      creativeType: String(this.getRowValue(row, ['Loại nội dung sáng tạo', 'Creative Type']) || 'N/A'),
      cost,
      gmv,
      roi: roiVal || (cost > 0 ? gmv / cost : 0),
      impressions,
      clicks,
      ctr: this.parseNumber(this.getRowValue(row, cols.ctr)),
      cvr: this.parseNumber(this.getRowValue(row, cols.cvr)),
      orders,
      costPerOrder: costPerOrderVal || (orders > 0 ? cost / orders : 0),
      videoViewRate2s: this.parseNumber(this.getRowValue(row, cols.videoViewRate2s)),
      videoViewRate6s: this.parseNumber(this.getRowValue(row, cols.videoViewRate6s)),
      videoViewRate25p: this.parseNumber(this.getRowValue(row, cols.videoViewRate25p)),
      videoViewRate50p: this.parseNumber(this.getRowValue(row, cols.videoViewRate50p)),
      videoViewRate75p: this.parseNumber(this.getRowValue(row, cols.videoViewRate75p)),
      videoViewRate100p: this.parseNumber(this.getRowValue(row, cols.videoViewRate100p)),
      cir: gmv > 0 ? (cost / gmv) * 100 : 0,
      cpc: clicks > 0 ? cost / clicks : 0,
    };
  }

  private mapOrderData(row: any): OrderData {
    return {
      order_id: String(this.getRowValue(row, ['ID đơn hàng', 'Order ID']) || ''),
      product_id: String(this.getRowValue(row, ['ID sản phẩm', 'Product ID']) || ''),
      product_name: String(this.getRowValue(row, ['Tên sản phẩm', 'Product Name']) || ''),
      seller_sku: String(this.getRowValue(row, ['Sku người bán', 'Seller SKU', 'SKU']) || ''),
      revenue: this.parseNumber(this.getRowValue(row, ['Payment Amount', 'Doanh thu', 'Giá'])),
      koc_username: String(this.getRowValue(row, ['Tên người dùng nhà sáng tạo', 'Creator Name']) || ''),
      video_id: String(this.getRowValue(row, ['Id nội dung', 'Content ID']) || ''),
      commission: this.parseNumber(this.getRowValue(row, ['Thanh toán hoa hồng thực tế', 'Commission'])),
      status: String(this.getRowValue(row, ['Trạng thái đơn hàng', 'Order Status']) || ''),
      return_status: String(this.getRowValue(row, ['Trả hàng & hoàn tiền', 'Return Status']) || ''),
      quantity: this.parseNumber(this.getRowValue(row, ['Số lượng', 'Quantity']) || 1),
    };
  }

  private mapInventoryData(row: any): InventoryData {
    return {
      inventory_sku: String(this.getRowValue(row, ['Mã SKU', 'SKU Code', 'SKU']) || ''),
      name: String(this.getRowValue(row, ['Tên', 'Product Name']) || ''),
      stock: this.parseNumber(this.getRowValue(row, ['Toàn bộ kho khả dụng', 'Available Stock', 'Tồn kho'])),
      cogs: this.parseNumber(this.getRowValue(row, ['Giá vốn', 'Cost Price', 'COGS'])),
    };
  }

  private parseNumber(value: any): number {
    if (value == null || value === '' || value === '-') return 0;
    if (typeof value === 'number') return value;
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
