import { Component, ChangeDetectionStrategy, inject, signal, OnInit, ElementRef, viewChild, afterNextRender } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GeminiService } from '../../services/gemini.service';
import { DataService } from '../../services/data.service';
import { EnterpriseService } from '../../services/enterprise.service';
import { ChatMessage } from '../../models/chat.model';

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
  
  chatHistory = signal<ChatMessage[]>([]);
  currentMessage = signal('');
  isLoading = signal(false);
  error = signal<string | null>(null);
  
  private systemInstruction = signal<string>('');
  private chatContainerEl = viewChild<ElementRef>('chatContainer');

  constructor() {
    afterNextRender(() => {
        this.scrollToBottom();
    });
  }

  ngOnInit(): void {
    const initialContext = this.dataService.summaryStats();
    
    const systemInstructionContent = this.enterpriseService.getPrompt('chatbot_context')?.content || 'You are a helpful assistant.';
    const fullSystemInstruction = `
      ${systemInstructionContent}
      
      Dưới đây là bản tóm tắt dữ liệu đã được tải lên:
      ${JSON.stringify(initialContext, null, 2)}
    `;
    this.systemInstruction.set(fullSystemInstruction);

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
        top: this.chatContainerEl().nativeElement.scrollHeight,
        behavior: 'smooth'
    });
  }
}
