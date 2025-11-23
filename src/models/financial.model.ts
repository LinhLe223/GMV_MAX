

export interface OrderData {
  order_id: string;
  koc_username: string;
  seller_sku: string;
  product_id: string;
  video_id: string;
  product_name: string;
  revenue: number;
  status: string;
  return_status: string;
  commission: number;
  quantity: number;
}

export interface InventoryData {
  inventory_sku: string;
  stock: number;
  cogs: number; // Cost of Goods Sold
  name: string;
}

export interface CostStructure {
  platformFeePercent: number; // Phí sàn (VD: 5% doanh thu)
  operatingFee: {
    type: 'fixed' | 'percent';
    value: number; // VD: 5000đ/đơn hoặc 2% doanh thu
  };
  otherCosts: Array<{
    id: string;
    name: string; // VD: "Phí đóng gói", "Marketing ngoài"
    type: 'fixed' | 'percent';
    value: number;
  }>;
}

export interface KocPnlData {
  kocName: string;
  normalizedKocName: string;
  // From Ads data
  adsCost: number;
  adsGmv: number;
  realRoas: number;
  // From Order data
  totalGmv: number; // Gross Merchandise Value from all orders (incl. failed)
  nmv: number; // Net Merchandise Value
  totalCommission: number;
  totalCogs: number;
  grossProfit: number;
  // Calculated
  netProfit: number;
  returnCancelPercent: number; // Percentage
  totalOrders: number;
  successOrders: number;
  failedOrders: number;
  latestVideoLink: string;
  // Strategic Metrics
  breakEvenRoas: number;
  daysOnHand: number;
  daysOnHandDisplay: string;
  stockQuantity: number;
  healthStatus: 'BLEEDING' | 'HEALTHY' | 'NEUTRAL';
  aiCommand: 'SCALE' | 'OPTIMIZE' | 'KILL' | 'MAINTAIN' | 'INVENTORY_ALERT' | '';
}

export interface EnrichedOrderData {
  order_id: string;
  product_id: string;
  product_name: string;
  status: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
  videoId: string;
  commission: number;
}

export interface KocDetailItem {
  videoId: string;
  videoName: string;
  productName: string;
  productId: string;
  nmv: number;
  cost: number;
  profit: number;
  returnCount: number;
  commission: number;
  roi: number;
  cir: number;
}

export interface ProductPnlData {
  productId: string;
  productName: string;
  sku: string;
  nmv: number;
  gmv: number;
  cogs: number;
  commission: number;
  adsCost: number;
  returnCount: number;
  successCount: number;
  totalCount: number;
  grossProfit: number;
  netProfit: number;
  returnRate: number;
  // Strategic Metrics
  breakEvenRoas: number;
  realRoas: number;
  daysOnHand: number;
  daysOnHandDisplay: string;
  stockQuantity: number;
  healthStatus: 'BLEEDING' | 'HEALTHY' | 'NEUTRAL';
  aiCommand: 'SCALE' | 'OPTIMIZE' | 'KILL' | 'MAINTAIN' | 'INVENTORY_ALERT' | 'STOCK_OUT' | '';
}