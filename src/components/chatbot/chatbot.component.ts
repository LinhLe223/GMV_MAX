import { Component, ChangeDetectionStrategy, inject, signal, OnInit, ElementRef, viewChild, afterNextRender, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GeminiService } from '../../services/gemini.service';
import { DataService } from '../../services/data.service';
import { EnterpriseService } from '../../services/enterprise.service';
import { ChatMessage } from '../../models/chat.model';
import { FinancialsService } from '../../services/financials.service';

@Component({
  selector: 'app-chatbot',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './chatbot.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ChatbotComponent implements OnInit {
  geminiService = inject(GeminiService);
  dataService = inject(DataService);
  enterpriseService = inject(EnterpriseService);
  financialsService = inject(FinancialsService);
  
  chatHistory = signal<ChatMessage[]>([]);
  currentMessage = signal('');
  isLoading = signal(false);
  error = signal<string | null>(null);
  
  private chatContainerEl = viewChild<ElementRef>('chatContainer');

  systemInstruction = computed(() => {
    const enterprisePrompt = this.enterpriseService.getPrompt('chatbot_context')?.content || 'You are a helpful assistant.';

    if (!this.financialsService.financialsLoaded()) {
        const adsSummary = this.dataService.summaryStats();
        const context = {
            "Ghi chú": "Hiện chỉ có dữ liệu Ads. Phân tích sẽ dựa trên các chỉ số quảng cáo.",
            "Tóm tắt dữ liệu Ads": adsSummary
        };
        return `${enterprisePrompt}\n\nDưới đây là bản tóm tắt dữ liệu đã được tải lên:\n${JSON.stringify(context, null, 2)}`;
    }

    // Financial data is loaded, provide richer context
    const pnlSummary = this.financialsService.dashboardMetrics();
    const costConfig = this.enterpriseService.getCostStructure();
    
    const topKocs = this.financialsService.kocPnlData()
      .sort((a, b) => b.netProfit - a.netProfit)
      .slice(0, 5)
      .map(k => ({
          kocName: k.kocName,
          netProfit: k.netProfit,
          adsCost: k.adsCost,
          nmv: k.nmv
      }));

    const bleedingKocs = this.financialsService.kocPnlData()
        .filter(k => k.healthStatus === 'BLEEDING')
        .slice(0, 3)
        .map(k => `KOC ${k.kocName} đang lỗ (Real ROAS: ${k.realRoas.toFixed(2)}, BE ROAS: ${k.breakEvenRoas.toFixed(2)})`);

    const lowStockProducts = this.financialsService.productPnlData()
        .filter(p => p.daysOnHand < 7 && p.daysOnHand > 0)
        .slice(0, 3)
        .map(p => `Sản phẩm ${p.productName} sắp hết hàng (còn ~${p.daysOnHand.toFixed(0)} ngày)`);

    const context = {
        "Ghi chú": "Đã có đủ dữ liệu Ads, Đơn hàng và Kho (GOD MODE). Phân tích sẽ tập trung vào Lợi nhuận ròng.",
        "Cấu hình Chi phí hiện tại": `Phí sàn ${costConfig.platformFeePercent}%, Phí vận hành ${costConfig.operatingFee.value}${costConfig.operatingFee.type === 'fixed' ? 'đ/đơn' : '%'}`,
        "Tóm tắt P&L Tổng quan": pnlSummary,
        "Top 5 KOC theo Lợi nhuận ròng": topKocs,
        "Cảnh báo Rủi ro": {
            "KOC đang 'chảy máu'": bleedingKocs.length > 0 ? bleedingKocs.join('; ') : "Không có KOC nào đang lỗ nặng.",
            "Tồn kho thấp": lowStockProducts.length > 0 ? lowStockProducts.join('; ') : "Tồn kho an toàn."
        }
    };

    return `${enterprisePrompt}\n\n[DỮ LIỆU TÀI CHÍNH VÀ P&L TÓM TẮT]\n${JSON.stringify(context, null, 2)}`;
});

  constructor() {
    afterNextRender(() => {
        this.scrollToBottom();
    });
  }

  ngOnInit(): void {
    if (!this.geminiService.isInitialized()) {
      this.error.set("Không thể khởi tạo Chatbot. Vui lòng kiểm tra API Key.");
    } else {
        this.chatHistory.set([{ role: 'model', text: 'Xin chào! Tôi là trợ lý AI của bạn. Bạn muốn biết điều gì về dữ liệu quảng cáo này?' }]);
    }
  }

  async sendMessage(): Promise<void> {
    const messageText = this.currentMessage().trim();
    if (!messageText || this.isLoading()) return;

    this.isLoading.set(true);
    this.currentMessage.set('');
    this.error.set(null);
    this.chatHistory.update(history => [...history, { role: 'user', text: messageText }]);
    this.chatHistory.update(history => [...history, { role: 'model', text: '' }]);
    
    this.scrollToBottom();
    let fullResponse = '';

    // Tiered context: last 10 messages. The initial context is in the system prompt.
    const historyToSend = this.chatHistory().slice(0, -2).slice(-10);

    try {
      const stream = this.geminiService.sendChatMessageStream(
        this.systemInstruction(),
        historyToSend,
        messageText,
        'chat_model'
      );
      for await (const chunkText of stream) {
        fullResponse += chunkText;
        this.chatHistory.update(history => {
            const lastMessage = history[history.length - 1];
            if (lastMessage) {
                lastMessage.text += chunkText;
            }
            return [...history];
        });
        this.scrollToBottom();
      }
    } catch (e) {
      console.error(e);
      const errorMessage = (e instanceof Error) ? e.message : 'Rất tiếc, đã có lỗi xảy ra. Vui lòng thử lại.';
      fullResponse = `ERROR: ${errorMessage}`;
      
      this.chatHistory.update(history => {
            const lastMessage = history[history.length - 1];
            if (lastMessage) {
              lastMessage.text = errorMessage;
            }
            return [...history];
      });
      this.error.set(errorMessage);
    } finally {
      this.isLoading.set(false);
      // Logging is now handled inside GeminiService
    }
  }

  private formatResponse(text: string): string {
    if (!text) return '';
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\* (.*?)(?:\n|$)/g, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
      .replace(/\n/g, '<br>');
  }

  private scrollToBottom(): void {
    this.chatContainerEl()?.nativeElement.scrollTo({
        top: this.chatContainerEl()().nativeElement.scrollHeight,
        behavior: 'smooth'
    });
  }
}