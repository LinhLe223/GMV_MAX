
import { Component, ChangeDetectionStrategy, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GeminiService, AnalysisMode } from '../../services/gemini.service';

@Component({
  selector: 'app-ai-analyzer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ai-analyzer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiAnalyzerComponent {
  geminiService = inject(GeminiService);

  promptKey = input.required<string>();
  data = input.required<any>();
  
  isLoading = signal(false);
  analysisResult = signal<string | null>(null);
  error = signal<string | null>(null);
  showResult = signal(false);
  selectedMode = signal<AnalysisMode>('standard');

  analysisModes: { id: AnalysisMode, name: string }[] = [
    { id: 'fast', name: 'Nhanh' },
    { id: 'standard', name: 'Tiêu chuẩn' },
    { id: 'deep', name: 'Chuyên sâu' },
  ];

  async analyze() {
    this.isLoading.set(true);
    this.error.set(null);
    this.analysisResult.set('');
    this.showResult.set(true);
    
    try {
      const stream = this.geminiService.getAnalysisStream(this.promptKey(), this.data(), this.selectedMode(), 'analysis_model');
      for await (const chunk of stream) {
        this.analysisResult.update(val => val + chunk);
      }
    } catch (e) {
      const errorMessage = (e instanceof Error) ? e.message : 'An unexpected error occurred during analysis.';
      this.error.set(errorMessage);
      this.analysisResult.set(null); // Clear any partial results on error
      console.error(e);
    } finally {
      this.isLoading.set(false);
    }
  }

  setMode(mode: AnalysisMode) {
    this.selectedMode.set(mode);
    if(this.showResult()) { // Re-analyze if result is already showing
      this.analyze();
    }
  }

  private formatResponse(text: string): string {
    if (!text) return '';
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-gray-900">$1</strong>')
      .replace(/\* (.*?)(<br>|$)/g, '<li class="ml-4 list-disc">$1</li>')
      .replace(/(\d)\.\s/g, '<br><strong class="font-semibold text-gray-900 mt-2 block">$1.</strong> ')
      .replace(/\n/g, '<br>');
  }

  toggleResult() {
      this.showResult.set(!this.showResult());
  }
}
