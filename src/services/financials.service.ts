





import { Injectable, signal, computed, inject } from '@angular/core';
import * as XLSX from 'xlsx';
import { OrderData, InventoryData, KocPnlData, EnrichedOrderData, ProductPnlData, KocDetailItem, GodModeItem } from '../models/financial.model';
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

  orderData = signal<OrderData[]>([]);
  inventoryData = signal<InventoryData[]>([]);
  kocPnlData = signal<KocPnlData[]>([]);
  godModeData = signal<GodModeItem[]>([]);
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

  private findCogs(orderSku: string, productName: string, inventory: InventoryData[]): number {
    const orderSkuClean = (orderSku || '').toLowerCase().trim();
    const productNameClean = (productName || '').toLowerCase();
  
    // Ưu tiên 1: Khớp chính xác Mã SKU
    const exactMatch = inventory.find(i => (i.inventory_sku || '').toLowerCase().trim() === orderSkuClean);
    if (exactMatch) return exactMatch.cogs;
  
    // Ưu tiên 2: Khớp Tên (Fuzzy Match)
    // Nếu Tên trong kho nằm trong Tên sản phẩm đơn hàng (VD: "Strong Men" trong "Combo Strong Men...")
    const nameMatch = inventory.find(i => i.name && productNameClean.includes(i.name.toLowerCase()));
    return nameMatch ? nameMatch.cogs : 0; // Không tìm thấy thì = 0
  }

  private calculatePnl(): void {
    const adsKocStats = this.dataService.kocReportStats();
    if (adsKocStats.length === 0) {
      throw new Error("Dữ liệu quảng cáo (Ads Data) chưa được tải. Vui lòng tải file ở trang Tổng quan trước.");
    }
    
    // Run new God Mode logic
    const adsData = this.dataService.rawData();
    const godModeItems = this.processMasterData(adsData, this.orderData(), this.inventoryData());
    this.godModeData.set(godModeItems);

    // Keep old PNL logic for other components
    const adsKocMap = new Map<string, KocReportStat>(adsKocStats.map(koc => [this.normalizeKoc(koc.name), koc]));

    const inventoryData = this.inventoryData();
    const inventorySkuMap = new Map<string, InventoryData[]>();
    inventoryData.forEach(item => {
        const key = (item.inventory_sku || '').toLowerCase().trim();
        if (key) {
            if (!inventorySkuMap.has(key)) inventorySkuMap.set(key, []);
            inventorySkuMap.get(key)!.push(item);
        }
    });

    const inventoryNameMap = new Map<string, InventoryData[]>();
    inventoryData.forEach(item => {
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

    const pnlByKoc = new Map<string, Omit<KocPnlData, 'kocName' | 'normalizedKocName' | 'adsCost' | 'adsGmv' | 'netProfit'>>();
    const enrichedOrdersByKoc = new Map<string, EnrichedOrderData[]>();
    
    const failedStatus = ['đã hủy', 'đã đóng', 'thất bại'];
    const refundKeywords = ['hoàn tiền'];
    const notFoundSkus = new Set<string>();

    let cogsFoundCount = 0;

    for (const [kocKey, orders] of ordersByKoc.entries()) {
        let totalGmv = 0, nmv = 0, totalCommission = 0, totalCogs = 0, failedOrders = 0, grossProfit = 0;
        let topRevenueOrder: OrderData | null = null;
        const enrichedOrders: EnrichedOrderData[] = [];
        
        const productsSoldByKoc = new Map<string, { soldQty: number }>();

        orders.forEach(order => {
            totalGmv += order.revenue;
            
            const status = (order.status || '').toLowerCase();
            const returnStatus = (order.return_status || '').toLowerCase();
            const isReal = !failedStatus.some(s => status.includes(s)) && !refundKeywords.some(kw => returnStatus.includes(kw));

            const cogsPerUnit = this.findCogsOld(order, inventorySkuMap, inventoryNameMap);
            const cogsForItem = cogsPerUnit * order.quantity;

            if (isReal) {
                nmv += order.revenue;
                totalCommission += order.commission;
                totalCogs += cogsForItem;
                grossProfit += order.revenue - cogsForItem;
                
                if (cogsPerUnit > 0) {
                    cogsFoundCount++;
                } else if(order.seller_sku) {
                    notFoundSkus.add(order.seller_sku);
                }

                if (!topRevenueOrder || order.revenue > topRevenueOrder.revenue) {
                    topRevenueOrder = order;
                }
                
                const productKey = order.seller_sku;
                if(productKey) {
                    const current = productsSoldByKoc.get(productKey) || { soldQty: 0};
                    current.soldQty += order.quantity || 1;
                    productsSoldByKoc.set(productKey, current);
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

        let totalStockForKoc = 0;
        let totalSoldQtyForKoc = 0;
        for (const [sku, sales] of productsSoldByKoc.entries()) {
            const stockInfo = inventoryData.find(inv => inv.inventory_sku === sku);
            if (stockInfo) {
                totalStockForKoc += stockInfo.stock;
            }
            totalSoldQtyForKoc += sales.soldQty;
        }
        const { days, display } = this.formatDaysOnHand(totalStockForKoc, totalSoldQtyForKoc);

        pnlByKoc.set(kocKey, {
            totalGmv,
            nmv,
            totalCommission,
            totalCogs,
            grossProfit,
            returnCancelPercent: orders.length > 0 ? (failedOrders / orders.length) * 100 : 0,
            totalOrders: orders.length,
            successOrders: orders.length - failedOrders,
            failedOrders,
            latestVideoLink,
            realRoas: 0,
            breakEvenRoas: 0,
            daysOnHand: days,
            daysOnHandDisplay: display,
            stockQuantity: totalStockForKoc,
            healthStatus: 'NEUTRAL',
            aiCommand: '',
        });
    }
    
    this.pnlDebugStats.set({ totalOrders: this.orderData().length, cogsFoundCount });
    this.notFoundSkus.set(Array.from(notFoundSkus));
    this.ordersWithCogsByKoc.set(enrichedOrdersByKoc);

    const finalPnlData: KocPnlData[] = [];
    const localUnmappedKocs: KocReportStat[] = [];
    const totalAdsGmv = this.dataService.summaryStats().totalGmv;
    const allKocKeys: Set<string> = new Set([...adsKocMap.keys(), ...pnlByKoc.keys()]);
    
    const costConfig = this.enterpriseService.getCostStructure();

    for (const normalizedKoc of allKocKeys) {
        const adsData = adsKocMap.get(normalizedKoc);
        const pnlData = pnlByKoc.get(normalizedKoc);

        if (adsData && !pnlData && adsData.totalGmv > (totalAdsGmv * 0.005)) {
             localUnmappedKocs.push(adsData);
        }

        const originalKocName = adsData?.name || ordersByKoc.get(normalizedKoc)?.[0]?.koc_username || normalizedKoc;
        const adsCost = adsData?.totalCost || 0;
        const nmv = pnlData?.nmv || 0;
        const totalCogs = pnlData?.totalCogs || 0;
        const totalCommission = pnlData?.totalCommission || 0;
        const successOrders = pnlData?.successOrders || 0;
        
        const platformFee = (nmv * costConfig.platformFeePercent) / 100;
        const operatingFee = costConfig.operatingFee.type === 'fixed'
            ? costConfig.operatingFee.value * successOrders
            : nmv * (costConfig.operatingFee.value / 100);
        const otherCostsTotal = costConfig.otherCosts.reduce((acc, cost) => {
            const costValue = cost.type === 'fixed'
                ? cost.value * successOrders
                : nmv * (cost.value / 100);
            return acc + costValue;
        }, 0);
        const totalDynamicFees = platformFee + operatingFee + otherCostsTotal;

        const netProfit = nmv - totalCogs - totalCommission - adsCost - totalDynamicFees;
        const realRoas = adsCost > 0 ? nmv / adsCost : 0;
        
        const contributionMargin = nmv - totalCogs - totalCommission - totalDynamicFees;
        const breakEvenRoas = contributionMargin > 0 ? nmv / contributionMargin : Infinity;
        
        let healthStatus: KocPnlData['healthStatus'] = 'NEUTRAL';
        if (netProfit < -500000 && adsCost > 1000000) healthStatus = 'BLEEDING';
        else if (netProfit > 500000) healthStatus = 'HEALTHY';

        let aiCommand: KocPnlData['aiCommand'] = '';
        if (healthStatus === 'BLEEDING') aiCommand = 'KILL';
        else if (healthStatus === 'HEALTHY' && realRoas > breakEvenRoas && realRoas > 1) aiCommand = 'SCALE';
        else if (netProfit > 0) aiCommand = 'MAINTAIN';
        else aiCommand = 'OPTIMIZE';

        finalPnlData.push({
            kocName: originalKocName,
            normalizedKocName: normalizedKoc,
            adsCost: adsCost,
            adsGmv: adsData?.totalGmv || 0,
            realRoas: realRoas,
            totalGmv: pnlData?.totalGmv || 0,
            nmv: nmv,
            totalCommission: totalCommission,
            totalCogs: totalCogs,
            grossProfit: pnlData?.grossProfit || 0,
            netProfit: netProfit,
            returnCancelPercent: pnlData?.returnCancelPercent || 0,
            totalOrders: pnlData?.totalOrders || 0,
            successOrders: pnlData?.successOrders || 0,
            failedOrders: pnlData?.failedOrders || 0,
            latestVideoLink: pnlData?.latestVideoLink || '',
            breakEvenRoas: breakEvenRoas,
            daysOnHand: pnlData?.daysOnHand ?? 0,
            daysOnHandDisplay: pnlData?.daysOnHandDisplay ?? '',
            stockQuantity: pnlData?.stockQuantity ?? 0,
            healthStatus: healthStatus,
            aiCommand: aiCommand
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
      const cogs = this.findCogsOld(o, inventorySkuMap, inventoryNameMap) * (o.quantity || 1);
      
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
    this.godModeData.set([]);
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

    const productMap = new Map<string, Omit<ProductPnlData, 'netProfit' | 'returnRate'> & { successQuantity: number }>();

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
          totalCount: 0,
          grossProfit: 0,
          successQuantity: 0,
          realRoas: 0,
          breakEvenRoas: 0,
          daysOnHand: 0,
          daysOnHandDisplay: '',
          stockQuantity: 0,
          healthStatus: 'NEUTRAL',
          aiCommand: ''
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
      
      const skuCost = this.findCogsOld(order, inventorySkuMap, inventoryNameMap);
      const orderCogs = (order.quantity || 1) * skuCost;

      if (isReturn) {
        item.returnCount++;
      } else {
        item.successCount++;
        item.nmv += order.revenue || 0;
        item.commission += order.commission || 0;
        item.cogs += orderCogs;
        item.grossProfit += (order.revenue || 0) - orderCogs;
        item.successQuantity += order.quantity || 1;
      }
    });

    return Array.from(productMap.values()).map(p => {
      const netProfit = p.grossProfit - p.commission - p.adsCost;
      const returnRate = p.totalCount > 0 ? (p.returnCount / p.totalCount) * 100 : 0;
      const realRoas = p.adsCost > 0 ? p.nmv / p.adsCost : 0;
      const grossProfitAfterCommission = p.grossProfit - p.commission;
      const breakEvenRoas = grossProfitAfterCommission > 0 ? p.nmv / grossProfitAfterCommission : 0;

      let healthStatus: ProductPnlData['healthStatus'] = 'NEUTRAL';
      if (netProfit < 0 && p.adsCost > 1000000) healthStatus = 'BLEEDING';
      else if (netProfit > 1000000) healthStatus = 'HEALTHY';
      
      const stockInfo = inventory.find(inv => inv.inventory_sku === p.sku || this.normalizeName(inv.name) === this.normalizeName(p.productName));
      const stockLevel = stockInfo?.stock ?? -1;
      
      const { days, display } = this.formatDaysOnHand(stockLevel, p.successQuantity);
      
      let aiCommand: ProductPnlData['aiCommand'] = '';
      if (stockLevel === 0) aiCommand = 'STOCK_OUT';
      else if (days > 0 && days < 7) aiCommand = 'INVENTORY_ALERT';
      else if (healthStatus === 'BLEEDING') aiCommand = 'KILL';
      else if (healthStatus === 'HEALTHY') aiCommand = 'SCALE';
      else if (netProfit < 0) aiCommand = 'OPTIMIZE';
      else aiCommand = 'MAINTAIN';

      return {
        ...p,
        netProfit,
        returnRate,
        realRoas,
        breakEvenRoas,
        daysOnHand: days,
        daysOnHandDisplay: display,
        stockQuantity: stockLevel,
        healthStatus,
        aiCommand
      };
    });
  }

  private findCogsOld(order: OrderData, inventorySkuMap: Map<string, InventoryData[]>, inventoryNameMap: Map<string, InventoryData[]>): number {
    const orderSkuClean = (order.seller_sku || '').toLowerCase().trim();
    const productNameClean = this.normalizeName(order.product_name || '');
    
    if (!orderSkuClean && !productNameClean) return 0;
    if (orderSkuClean) {
        const exactMatch = inventorySkuMap.get(orderSkuClean);
        if (exactMatch && exactMatch.length > 0) {
            return exactMatch[0].cogs;
        }
    }
    if (orderSkuClean) {
        for (const [invSku, invItems] of inventorySkuMap.entries()) {
            if (invSku && orderSkuClean.includes(invSku)) {
                return invItems[0].cogs;
            }
        }
    }
    if (productNameClean) {
        for (const [invName, invItems] of inventoryNameMap.entries()) {
            if (invName && productNameClean.includes(invName)) {
                return invItems[0].cogs;
            }
        }
    }
    
    return 0;
  }

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
  
  public processMasterData(adsData: TiktokAd[], orderData: OrderData[], inventoryData: InventoryData[]): GodModeItem[] {
    const adsMap = new Map<string, { cost: number, gmv: number }>();
    for (const ad of adsData) {
      const mergeKey = this.normalizeKocName(ad.tiktokAccount);
      if (!mergeKey) continue;
      const current = adsMap.get(mergeKey) || { cost: 0, gmv: 0 };
      current.cost += ad.cost;
      current.gmv += ad.gmv;
      adsMap.set(mergeKey, current);
    }

    const orderMap = new Map<string, {
      kocName: string;
      nmv: number;
      commission: number;
      totalOrders: number;
      returnCount: number;
      cogs: number;
    }>();

    const failedStatus = ['đã hủy', 'đã đóng', 'thất bại'];
    const refundKeywords = ['hoàn tiền'];

    for (const order of orderData) {
      const mergeKey = this.normalizeKocName(order.koc_username);
      if (!mergeKey) continue;

      if (!orderMap.has(mergeKey)) {
        orderMap.set(mergeKey, {
          kocName: order.koc_username || 'Unknown',
          nmv: 0,
          commission: 0,
          totalOrders: 0,
          returnCount: 0,
          cogs: 0,
        });
      }
      const current = orderMap.get(mergeKey)!;

      current.totalOrders++;

      const status = (order.status || '').toLowerCase();
      const returnStatus = (order.return_status || '').toLowerCase();
      const isFailed = failedStatus.some(s => status.includes(s)) || refundKeywords.some(kw => returnStatus.includes(kw));

      if (isFailed) {
        current.returnCount++;
      } else {
        const orderCogs = this.findCogs(order.seller_sku, order.product_name, inventoryData) * (order.quantity || 1);
        current.nmv += order.revenue;
        current.commission += order.commission;
        current.cogs += orderCogs;
      }
    }

    const allKeys = new Set([...adsMap.keys(), ...orderMap.keys()]);
    const result: GodModeItem[] = [];

    for (const mergeKey of allKeys) {
      const adInfo = adsMap.get(mergeKey) || { cost: 0, gmv: 0 };
      const orderInfo = orderMap.get(mergeKey) || {
        kocName: adsData.find(ad => this.normalizeKocName(ad.tiktokAccount) === mergeKey)?.tiktokAccount || mergeKey,
        nmv: 0,
        commission: 0,
        totalOrders: 0,
        returnCount: 0,
        cogs: 0
      };

      const netProfit = orderInfo.nmv - orderInfo.cogs - orderInfo.commission - adInfo.cost;
      const realRoas = adInfo.cost > 0 ? orderInfo.nmv / adInfo.cost : 0;
      const returnRate = orderInfo.totalOrders > 0 ? (orderInfo.returnCount / orderInfo.totalOrders) * 100 : 0;

      result.push({
        kocName: orderInfo.kocName,
        mergeKey,
        adsCost: adInfo.cost,
        adsGmv: adInfo.gmv,
        nmv: orderInfo.nmv,
        commission: orderInfo.commission,
        totalOrders: orderInfo.totalOrders,
        returnCount: orderInfo.returnCount,
        cogs: orderInfo.cogs,
        netProfit,
        realRoas,
        returnRate,
      });
    }

    return result;
  }

  getKocDetails(kocMergeKey: string, adsData: TiktokAd[]): KocDetailItem[] {
    const orders = this.ordersWithCogsByKoc().get(kocMergeKey) || [];
    if (orders.length === 0) return [];

    const adsByVideoId = new Map<string, TiktokAd>();
    adsData.filter(ad => this.normalizeKoc(ad.tiktokAccount) === kocMergeKey)
           .forEach(ad => {
             if (ad.videoId) {
               adsByVideoId.set(ad.videoId, ad);
             }
           });

    const detailsByVideo = new Map<string, {
        nmv: number;
        returnCount: number;
        commission: number;
        productName: string;
        productId: string;
    }>();

    const failedStatus = ['đã hủy', 'đã đóng', 'thất bại'];
    const refundKeywords = ['hoàn tiền'];

    for (const order of orders) {
      const videoId = order.videoId || 'no-video';
      if (!detailsByVideo.has(videoId)) {
        detailsByVideo.set(videoId, {
          nmv: 0,
          returnCount: 0,
          commission: 0,
          productName: order.product_name,
          productId: order.product_id,
        });
      }

      const detail = detailsByVideo.get(videoId)!;
      const status = (order.status || '').toLowerCase();
      const isFailed = failedStatus.some(s => status.includes(s)) || refundKeywords.some(kw => status.includes(kw));

      if (!isFailed) {
          detail.nmv += order.revenue;
          detail.commission += order.commission;
      } else {
          detail.returnCount++;
      }
    }
    
    return Array.from(detailsByVideo.entries()).map(([videoId, data]) => {
        const adData = adsByVideoId.get(videoId);
        const cost = adData?.cost || 0;
        const profit = data.nmv - cost - data.commission;
        const roi = cost > 0 ? data.nmv / cost : 0;
        const cir = data.nmv > 0 ? (cost / data.nmv) * 100 : 0;
        
        return {
            videoId: videoId,
            videoName: adData?.videoTitle || 'N/A',
            productName: data.productName,
            productId: data.productId,
            nmv: data.nmv,
            cost: cost,
            profit: profit,
            returnCount: data.returnCount,
            commission: data.commission,
            roi: roi,
            cir: cir,
        };
    });
  }

  private formatDaysOnHand(stock: number, soldQty: number, periodDays: number = 30): { days: number, display: string } {
    if (stock <= 0) return { days: 0, display: 'Hết hàng' };
    if (soldQty <= 0) return { days: Infinity, display: '> 999 ngày' };

    const avgDailySales = soldQty / periodDays;
    const days = stock / avgDailySales;
    
    if (days === Infinity) return { days, display: '> 999 ngày'};
    if (days > 365) return { days, display: '> 1 năm' };
    return { days, display: `${Math.round(days)} ngày` };
  }
}