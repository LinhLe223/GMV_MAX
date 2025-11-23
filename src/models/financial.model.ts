

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

export interface KocPnlData {
  kocName: string;
  normalizedKocName: string;
  // From Ads data
  adsCost: number;
  adsGmv: number;
  // From Order data
  totalGmv: number; // Gross Merchandise Value from all orders (incl. failed)
  nmv: number; // Net Merchandise Value
  totalCommission: number;
  totalCogs: number;
  // Calculated
  netProfit: number;
  returnCancelPercent: number; // Percentage
  totalOrders: number;
  failedOrders: number;
  latestVideoLink: string;
  // FIX: Added missing properties for UI suggestions. These were being assigned in
  // financials.service.ts but were missing from the type definition, causing an error.
  suggestion: string;
  suggestionColor: string;
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
  revenue: number;
  cost: number;
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
  netProfit: number;
  returnRate: number;
}
