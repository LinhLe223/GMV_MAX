export interface TiktokAd {
  campaignName: string;
  productId: string;
  videoTitle: string;
  videoId: string;
  tiktokAccount: string; // KOC/KOL
  creativeType: string; // "Video" or "Thẻ sản phẩm"
  cost: number;
  gmv: number; // Gross Merchandise Value (Doanh thu gộp)
  roi: number;
  impressions: number;
  clicks: number;
  ctr: number; // Click-Through Rate
  cvr: number; // Conversion Rate
  orders: number;
  costPerOrder: number;
  videoViewRate2s: number;
  videoViewRate6s: number;
  videoViewRate25p: number;
  videoViewRate50p: number;
  videoViewRate75p: number;
  videoViewRate100p: number;
  // Calculated fields
  cir: number; // Cost to Income Ratio
  cpc: number; // Cost Per Click
}