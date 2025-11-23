

import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit, ElementRef, viewChild, effect, afterNextRender } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GeminiService } from '../../services/gemini.service';
import { EnterpriseService } from '../../services/enterprise.service';
import { DataService } from '../../services/data.service';
import { FinancialsService } from '../../services/financials.service';
import { CampaignPlan } from '../../models/user.model';

interface AdvisorFormState {
  targetGmv: number;
  targetRoi: number;
  duration: number;
}

interface CreativeActionItem {
  videoId: string;
  videoTitle: string;
  roi: number;
  gmv: number;
  cost: number;
  action: 'SCALE_X5' | 'SCALE_X3' | 'MONITOR' | 'OPTIMIZE_COST' | 'PAUSE' | string;
  reasoning: string;
  status: 'accepted' | 'rejected'; // Client-side state
}

interface AIPlan {
  productStrategy: {
    productName: string;
    reasoning: string;
    suggestion: string;
  }[];
  creativeScalingPlan: CreativeActionItem[];
  summary: {
    estimatedDailyBudget: number;
    knowledgeSummary: string;
    overallStrategy: string;
  };
  financialProjection: {
    scaleUpBudgetSuggestion: string;
    boosterAdsSuggestion: string;
    roadmapTable: {
      metric: string;
      current: string;
      newTarget: string;
      notes: string;
    }[];
  }
}

@Component({
  selector: 'app-ai-advisor',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ai-advisor.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiAdvisorComponent implements OnInit {
  geminiService = inject(GeminiService);
  enterpriseService = inject(EnterpriseService);
  dataService = inject(DataService);
  financialsService = inject(FinancialsService);
  
  isLoading = signal(false);
  error = signal<string | null>(null);
  
  formState = signal<AdvisorFormState>({
    targetGmv: 5000000000,
    targetRoi: 4.0,
    duration: 14,
  });
  durationOptions = [3, 7, 14, 28, 30];
  
  allProducts = signal<{ name: string }[]>([]);
  excludedProducts = signal<string[]>([]);
  exclusionSearchTerm = signal('');
  selectedProducts = signal<string[]>([]);
  selectedKocs = signal<string[]>([]);

  // New P&L strategy toggles
  useInventoryStrategy = signal(false);
  useProfitStrategy = signal(false);

  // --- New Interactive Plan State ---
  plan = signal<AIPlan | null>(null);
  thinkingSteps = signal<{ text: string; done: boolean }[]>([]);
  
  // --- Save Plan State ---
  isSaving = signal(false);
  saveSuccess = signal(false);
  saveError = signal<string | null>(null);

  private chatContainerEl = viewChild<ElementRef>('chatContainer');

  constructor() {
    effect(() => {
        const available = this.availableKocs();
        this.selectedKocs.update(selected => selected.filter(koc => available.includes(koc)));
    });
    afterNextRender(() => this.scrollToBottom());
  }

  ngOnInit(): void {
    // Restore state if a plan was being worked on
    const activePlan = this.enterpriseService.activeAdvisorPlan();
    if (activePlan) {
      this.plan.set(activePlan);
    }
    
    const uniqueCampaigns = [...new Set<string>(this.dataService.rawData().map(item => item.campaignName))];
    this.allProducts.set(uniqueCampaigns.map(name => ({ name })).sort((a,b) => a.name.localeCompare(b.name)));
  }

  // --- Dynamic Filters ---
  filteredForExclusion = computed(() => {
    const all = this.allProducts();
    const term = this.exclusionSearchTerm().toLowerCase();
    if (!term) return all;
    return all.filter(product => product.name.toLowerCase().includes(term));
  });

  isAllFilteredForExclusionSelected = computed(() => {
    const filtered = this.filteredForExclusion();
    const excluded = this.excludedProducts();
    if (filtered.length === 0) return false;
    return filtered.every(p => excluded.includes(p.name));
  });

  availableProducts = computed(() => this.allProducts().filter(p => !this.excludedProducts().includes(p.name)));
  availableKocs = computed(() => {
    const products = this.selectedProducts();
    if (products.length === 0) return [];
    const relevantVideos = this.dataService.videoData().filter(
      v => products.includes(v.campaignName) && v.tiktokAccount !== 'Unknown'
    );
    return [...new Set(relevantVideos.map(v => v.tiktokAccount))].sort();
  });

  isAllAvailableSelected = computed(() => {
    const available = this.availableProducts();
    const selected = this.selectedProducts();
    if (available.length === 0) return false;
    return available.length > 0 && available.length === selected.length && available.every(p => selected.includes(p.name));
  });

  toggleExcludedProductSelection(productName: string) {
    this.excludedProducts.update(excluded => 
      excluded.includes(productName) ? excluded.filter(p => p !== productName) : [...excluded, productName]
    );
    this.selectedProducts.update(mainSelected => mainSelected.filter(p => p !== productName));
  }

  toggleSelectAllFilteredForExclusion() {
    const isAllSelected = this.isAllFilteredForExclusionSelected();
    const filteredNames = this.filteredForExclusion().map(p => p.name);
    this.excludedProducts.update(current => {
      const filteredSet = new Set(filteredNames);
      if (isAllSelected) {
        return current.filter(p => !filteredSet.has(p));
      } else {
        return Array.from(new Set([...current, ...filteredNames]));
      }
    });
    if (!isAllSelected) {
      const filteredSet = new Set(filteredNames);
      this.selectedProducts.update(current => current.filter(p => !filteredSet.has(p)));
    }
  }

  isSelectedExcludedProduct = (name: string): boolean => this.excludedProducts().includes(name);
  toggleProductSelection = (name: string) => this.selectedProducts.update(s => s.includes(name) ? s.filter(p => p !== name) : [...s, name]);
  isSelectedProduct = (name: string): boolean => this.selectedProducts().includes(name);
  toggleKocSelection = (name: string) => this.selectedKocs.update(s => s.includes(name) ? s.filter(k => k !== name) : [...s, name]);
  isSelectedKoc = (name: string): boolean => this.selectedKocs().includes(name);

  toggleSelectAllAvailable() {
    this.selectedProducts.set(this.isAllAvailableSelected() ? [] : this.availableProducts().map(p => p.name));
  }
  
  updateFormState<K extends keyof AdvisorFormState>(key: K, value: AdvisorFormState[K]) {
    this.formState.update(current => ({ ...current, [key]: value }));
  }

  private buildFinancialContext(): string {
    let financialContext = '';

    if (this.useInventoryStrategy()) {
      if (!this.financialsService.financialsLoaded()) {
        this.error.set("Cảnh báo: Dữ liệu Tồn kho chưa được tải. Chiến lược Xả kho sẽ không được áp dụng.");
      } else {
        const highStockItems = [...this.financialsService.inventoryData()]
          .sort((a, b) => b.stock - a.stock)
          .slice(0, 10);
        if (highStockItems.length > 0) {
          financialContext += `\n[CHIẾN LƯỢC XẢ KHO]\nCác sản phẩm sau đang có lượng tồn kho rất cao. Ưu tiên đề xuất ngân sách và ý tưởng để đẩy mạnh xả kho cho các mã SKU này:\n`;
          highStockItems.forEach(item => {
            financialContext += `- SKU: ${item.sku}, Tồn kho: ${item.stock}\n`;
          });
        }
      }
    }

    if (this.useProfitStrategy()) {
      if (!this.financialsService.financialsLoaded()) {
         this.error.set("Cảnh báo: Dữ liệu Đơn hàng chưa được tải. Chiến lược Tối ưu Lợi nhuận sẽ không được áp dụng.");
      } else {
        const losingKocs = this.financialsService.kocPnlData()
          .filter(k => k.netProfit < 0)
          .sort((a, b) => a.netProfit - b.netProfit);
        if (losingKocs.length > 0) {
          financialContext += `\n[TỐI ƯU LỢI NHUẬN THỰC]\nCảnh báo quan trọng! Đừng chỉ nhìn vào ROI quảng cáo. Các KOC sau đây đang gây LỖ RÒNG trên thực tế. Cân nhắc cắt giảm ngân sách hoặc dừng hợp tác:\n`;
          losingKocs.slice(0, 5).forEach(koc => {
            financialContext += `- KOC: ${koc.kocName}, Lỗ ròng: ${Math.abs(koc.netProfit).toLocaleString('vi-VN')} đ\n`;
          });
        }
      }
    }

    return financialContext;
  }

  async generateInitialPlan() {
    this.isLoading.set(true);
    this.error.set(null);
    this.plan.set(null);
    this.enterpriseService.activeAdvisorPlan.set(null); // Clear previous plan

    const financialContext = this.buildFinancialContext();

    const steps = [
      "🔍 Đang quét và lọc dữ liệu chiến dịch...",
      "📚 Đang tra cứu kiến thức từ GMV Max...",
      "💡 Đang xác định các sản phẩm và video chủ lực...",
      "⚡ Đang tính toán và xây dựng kế hoạch tối ưu...",
      "🎨 Đang tạo Giao diện Tương tác..."
    ];
    this.thinkingSteps.set(steps.map(s => ({ text: s, done: false })));

    for (let i = 0; i < steps.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 500));
      this.thinkingSteps.update(currentSteps => {
          currentSteps[i].done = true;
          return [...currentSteps];
      });
    }

    try {
      const { targetGmv, targetRoi, duration } = this.formState();
      
      const allData = this.dataService.rawData();
      const selectedProducts = this.selectedProducts();
      const selectedKocs = this.selectedKocs();

      const productFilteredData = selectedProducts.length > 0 ? allData.filter(row => selectedProducts.includes(row.campaignName)) : allData;
      const videoDataForCreativePool = this.dataService.videoData().filter(row =>
          (selectedProducts.length === 0 || selectedProducts.includes(row.campaignName)) &&
          (selectedKocs.length === 0 || selectedKocs.includes(row.tiktokAccount))
      );

      const productStats = new Map<string, { gmv: number, cost: number, roi: number, orders: number, productId: string, campaignName: string }>();
      productFilteredData.forEach(row => {
        const key = `${row.campaignName} | ${row.productId}`;
        if (!productStats.has(key)) productStats.set(key, { gmv: 0, cost: 0, roi: 0, orders: 0, productId: row.productId, campaignName: row.campaignName });
        const stats = productStats.get(key)!;
        stats.gmv += row.gmv;
        stats.cost += row.cost;
        stats.orders += row.orders;
      });
      const topProducts = Array.from(productStats.values()).map(stats => ({
        ...stats,
        roi: stats.cost > 0 ? stats.gmv / stats.cost : 0
      })).sort((a, b) => b.gmv - a.gmv).slice(0, 10);
      
      let summaryProductsTable = '| Tên chiến dịch | ID Sản phẩm | Tổng Doanh thu (VND) | Tổng Chi phí (VND) | ROI | Tổng Đơn hàng |\n|---|---|---|---|---|---|\n';
      topProducts.forEach(p => summaryProductsTable += `| ${p.campaignName} | ${p.productId} | ${Math.round(p.gmv)} | ${Math.round(p.cost)} | ${p.roi.toFixed(2)} | ${p.orders} |\n`);
      if (topProducts.length === 0) summaryProductsTable = "Không có dữ liệu sản phẩm phù hợp.";

      const potentialVideos = videoDataForCreativePool.filter(v => v.roi >= 4.0 || (v.gmv > 5000000 && v.roi > 1.5) || v.ctr > 1.5).sort((a, b) => b.roi - a.roi).slice(0, 50);
      let summaryVideosTable = '| ID Video | Tiêu đề | ROI | CTR (%) | Doanh thu (VND) | Chi phí (VND) |\n|---|---|---|---|---|---|\n';
      potentialVideos.forEach(v => summaryVideosTable += `| ${v.videoId} | ${v.videoTitle.replace(/\|/g, ' ').substring(0, 50)} | ${v.roi.toFixed(2)} | ${v.ctr.toFixed(2)} | ${Math.round(v.gmv)} | ${Math.round(v.cost)} |\n`);
      if (potentialVideos.length === 0) summaryVideosTable = "Không tìm thấy video nào tiềm năng.";

      const current_avg_roi = this.dataService.summaryStats().avgRoi;
      
      const knowledgeItems = this.enterpriseService.getKnowledgeBase();
      const knowledgeParts = knowledgeItems.map(item => ({ 
        inlineData: { 
          mimeType: item.mimeType, 
          data: item.base64Data.split(',')[1] 
        } 
      }));
      const promptTemplate = this.enterpriseService.getPrompt('advisor_data_driven')?.content || '';
      const textPrompt = promptTemplate
        .replace('{summary_products_table}', summaryProductsTable)
        .replace('{summary_videos_table}', summaryVideosTable)
        .replace('{financial_context}', financialContext)
        .replace('{target_gmv}', targetGmv.toLocaleString('vi-VN'))
        .replace(/{target_roi}/g, targetRoi.toString())
        .replace(/{duration}/g, duration.toString())
        .replace('{current_avg_roi}', current_avg_roi.toFixed(2))
        .replace('{has_ads}', this.dataService.dataLoaded() ? 'Có' : 'Không')
        .replace('{has_order}', this.financialsService.orderData().length > 0 ? 'Có' : 'Không')
        .replace('{has_stock}', this.financialsService.inventoryData().length > 0 ? 'Có' : 'Không');
        
      const textPart = { text: textPrompt };
      const fullContent = { parts: [textPart, ...knowledgeParts] };

      let fullResponse = '';
      const stream = this.geminiService.getAnalysisStream('advisor_data_driven', fullContent, 'deep', 'advisor_model');
      for await (const chunk of stream) {
        fullResponse += chunk;
      }
      
      // Check for error messages from GeminiService before parsing
      if (fullResponse.startsWith('Lỗi:') || fullResponse.startsWith('Đã xảy ra lỗi')) {
        throw new Error(fullResponse);
      }
      
      const parsedPlan: AIPlan = JSON.parse(fullResponse);
      parsedPlan.creativeScalingPlan = parsedPlan.creativeScalingPlan.map(item => ({ ...item, status: 'accepted' }));
      this.plan.set(parsedPlan);
      this.enterpriseService.activeAdvisorPlan.set(parsedPlan); // Save to service for persistence

    } catch (e) {
      const errorMessage = (e instanceof Error) ? e.message : 'An unexpected error occurred.';
      this.error.set(`Lỗi phân tích: ${errorMessage}`);
      console.error(e);
    } finally {
      this.isLoading.set(false);
    }
  }

  toggleActionStatus(videoId: string) {
    this.plan.update(currentPlan => {
      if (!currentPlan) return null;
      const newPlan = {
        ...currentPlan,
        creativeScalingPlan: currentPlan.creativeScalingPlan.map(item => 
          item.videoId === videoId 
            ? { ...item, status: item.status === 'accepted' ? 'rejected' : 'accepted' }
            : item
        )
      };
      this.enterpriseService.activeAdvisorPlan.set(newPlan); // Keep service state in sync
      return newPlan;
    });
  }

  planSummary = computed(() => {
    const currentPlan = this.plan();
    if (!currentPlan) return { videosToScale: 0, videosToMonitor: 0, videosToPause: 0, estimatedDailyBudget: 0 };
    
    const acceptedActions = currentPlan.creativeScalingPlan.filter(item => item.status === 'accepted');
    
    // Recalculate budget based on accepted items.
    const initialTotalBudget = currentPlan.summary.estimatedDailyBudget;
    const totalCostOfAllSuggestions = currentPlan.creativeScalingPlan.reduce((sum, item) => sum + (item.cost || 0), 0);

    let adjustedBudget = 0;
    if (totalCostOfAllSuggestions > 0) {
      const acceptedCost = acceptedActions.reduce((sum, item) => sum + (item.cost || 0), 0);
      adjustedBudget = (acceptedCost / totalCostOfAllSuggestions) * initialTotalBudget;
    } else {
      // If costs are zero, we can't prorate. Just show total if anything is accepted.
      adjustedBudget = acceptedActions.length > 0 ? initialTotalBudget : 0;
    }

    return {
      videosToScale: acceptedActions.filter(a => a.action.startsWith('SCALE')).length,
      videosToMonitor: acceptedActions.filter(a => a.action === 'MONITOR').length,
      videosToPause: acceptedActions.filter(a => a.action === 'PAUSE' || a.action === 'OPTIMIZE_COST').length,
      estimatedDailyBudget: adjustedBudget,
    };
  });
  
  getActionClass(action: string): string {
    if (action.startsWith('SCALE')) return 'bg-green-100 text-green-800';
    if (action === 'MONITOR') return 'bg-blue-100 text-blue-800';
    if (action === 'PAUSE' || action === 'OPTIMIZE_COST') return 'bg-yellow-100 text-yellow-800';
    return 'bg-gray-100 text-gray-800';
  }

  savePlan() {
    this.isSaving.set(true);
    this.saveSuccess.set(false);
    this.saveError.set(null);
    const currentPlan = this.plan();
    if (!currentPlan) {
      this.saveError.set("Không có kế hoạch nào để lưu.");
      this.isSaving.set(false);
      return;
    }

    try {
      const form = this.formState();
      const summary = this.planSummary();
      const totalBudget = summary.estimatedDailyBudget * form.duration;

      this.enterpriseService.addCampaignPlan({
        plan_name: `Kế hoạch GMV Max - ${new Date().toLocaleDateString('vi-VN')}`,
        target_gmv: form.targetGmv,
        target_roi: form.targetRoi,
        total_budget: totalBudget,
        ai_response_content: JSON.stringify(currentPlan),
      });
      
      this.enterpriseService.activeAdvisorPlan.set(null); // Clear the active plan after saving
      
      this.enterpriseService.logActivity({
        action_type: 'plan_saved',
        input_data: JSON.stringify({ formState: form, summary }),
        ai_response: 'Plan saved successfully'
      });
      
      this.saveSuccess.set(true);
      setTimeout(() => this.saveSuccess.set(false), 4000);

    } catch(e) {
      this.saveError.set(`Lỗi khi lưu kế hoạch: ${(e as Error).message}`);
    } finally {
      this.isSaving.set(false);
    }
  }

  private scrollToBottom(): void {
    if (this.chatContainerEl()?.nativeElement) {
      this.chatContainerEl()!.nativeElement.scrollTo({
          top: this.chatContainerEl()!.nativeElement.scrollHeight,
          behavior: 'smooth'
      });
    }
  }
}