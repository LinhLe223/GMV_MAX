import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EnterpriseService } from '../../services/enterprise.service';
import { GeminiService } from '../../services/gemini.service';
import { CampaignPlan } from '../../models/user.model';
import * as XLSX from 'xlsx';

// --- Interfaces copied from AI Advisor for type safety ---
interface CreativeActionItem {
  videoId: string;
  videoTitle: string;
  roi: number;
  gmv: number;
  cost: number;
  action: string;
  reasoning: string;
  status: 'accepted' | 'rejected';
}

interface AIPlan {
  productStrategy: { productName: string; reasoning: string; suggestion: string; }[];
  creativeScalingPlan: CreativeActionItem[];
  summary: { estimatedDailyBudget: number; knowledgeSummary: string; overallStrategy: string; };
  financialProjection: {
    scaleUpBudgetSuggestion: string;
    boosterAdsSuggestion: string;
    roadmapTable: { metric: string; current: string; newTarget: string; notes: string; }[];
  }
}

@Component({
  selector: 'app-action-plan',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './action-plan.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActionPlanComponent {
  enterpriseService = inject(EnterpriseService);
  geminiService = inject(GeminiService);

  viewMode = signal<'list' | 'detail'>('list');
  plans = computed(() => this.enterpriseService.getCampaignPlansForCurrentUser());
  selectedPlan = signal<CampaignPlan | null>(null);
  
  // Detail view state
  detailTab = signal<'plan' | 'results'>('plan');
  parsedPlanContent = computed<AIPlan | null>(() => {
    const plan = this.selectedPlan();
    if (!plan) return null;
    try {
      const parsed = JSON.parse(plan.ai_response_content);
      // Defensively parse the plan to prevent runtime errors from incomplete AI responses.
      return {
        productStrategy: Array.isArray(parsed.productStrategy) ? parsed.productStrategy : [],
        creativeScalingPlan: (Array.isArray(parsed.creativeScalingPlan) ? parsed.creativeScalingPlan : [])
          .map((item: any) => ({
            videoId: item?.videoId || 'N/A',
            videoTitle: item?.videoTitle || 'Unknown Title',
            roi: item?.roi || 0,
            gmv: item?.gmv || 0,
            cost: item?.cost || 0,
            action: item?.action || 'MONITOR',
            reasoning: item?.reasoning || 'No reasoning provided.',
            status: item?.status || 'accepted'
          })),
        summary: parsed.summary || { estimatedDailyBudget: 0, knowledgeSummary: '', overallStrategy: '' },
        financialProjection: parsed.financialProjection || { scaleUpBudgetSuggestion: '', boosterAdsSuggestion: '', roadmapTable: [] },
      };
    } catch (e) {
      console.error("Failed to parse plan content:", e);
      return null;
    }
  });

  // Feedback loop state
  feedbackFileContent = signal<string | null>(null);
  feedbackFileName = signal<string | null>(null);
  isReviewing = signal(false);
  reviewError = signal<string | null>(null);

  selectPlan(plan: CampaignPlan) {
    this.selectedPlan.set(plan);
    this.viewMode.set('detail');
    this.detailTab.set('plan');
    this.feedbackFileContent.set(null);
    this.feedbackFileName.set(null);
    this.reviewError.set(null);
  }

  goBackToList() {
    this.viewMode.set('list');
    this.selectedPlan.set(null);
  }

  handleFeedbackFile(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    this.reviewError.set(null);
    this.feedbackFileName.set(file.name);
    const reader = new FileReader();
    reader.onload = (e: any) => {
      try {
        const bstr: string = e.target.result;
        const wb: XLSX.WorkBook = XLSX.read(bstr, { type: 'binary' });
        const wsname: string = wb.SheetNames[0];
        const ws: XLSX.WorkSheet = wb.Sheets[wsname];
        const rawData: any[] = XLSX.utils.sheet_to_json(ws, { raw: false });
        
        // Summarize to avoid large payloads
        const summary = {
            fileName: file.name,
            totalRows: rawData.length,
            columns: rawData.length > 0 ? Object.keys(rawData[0]) : [],
            // Provide a sample of up to 20 rows
            sampleData: rawData.slice(0, 20),
        };
        this.feedbackFileContent.set(JSON.stringify(summary, null, 2));

      } catch (error) {
        this.reviewError.set("Lỗi khi đọc file. Vui lòng kiểm tra định dạng.");
        this.feedbackFileContent.set(null);
        this.feedbackFileName.set(null);
      }
    };
    reader.readAsBinaryString(file);
  }

  async runAIReview() {
    const plan = this.selectedPlan();
    const results = this.feedbackFileContent();
    if (!plan || !results) {
      this.reviewError.set("Vui lòng tải lên file kết quả.");
      return;
    }

    this.isReviewing.set(true);
    this.reviewError.set(null);

    const promptTemplate = this.enterpriseService.getPrompt('advisor_feedback_analyzer')?.content || '';
    const fullPrompt = promptTemplate
      .replace('{original_plan}', plan.ai_response_content)
      .replace('{actual_result_summary}', results);

    try {
      let fullResponse = '';
      const stream = this.geminiService.getAnalysisStream('advisor_feedback_analyzer', fullPrompt, 'standard', 'analysis_model');
      for await (const chunk of stream) {
        fullResponse += chunk;
      }

      const updatedPlan: CampaignPlan = {
        ...plan,
        status: 'reviewed',
        ai_review: fullResponse,
        actual_result_file_content: results,
      };
      
      this.enterpriseService.updateCampaignPlan(updatedPlan);
      this.selectedPlan.set(updatedPlan); // Update the view

    } catch (e) {
      this.reviewError.set(`Lỗi phân tích: ${(e as Error).message}`);
    } finally {
      this.isReviewing.set(false);
    }
  }

  getStatusClass(status: CampaignPlan['status']): string {
    switch (status) {
      case 'planning': return 'bg-blue-100 text-blue-800';
      case 'running': return 'bg-yellow-100 text-yellow-800';
      case 'completed': return 'bg-green-100 text-green-800';
      case 'reviewed': return 'bg-indigo-100 text-indigo-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  }

  formatResponse(text: string): string {
    if (!text) return '';
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\* (.*?)(?:\n|$)/g, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
      .replace(/\n/g, '<br>');
  }
}