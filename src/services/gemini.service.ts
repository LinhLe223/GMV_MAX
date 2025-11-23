import { Injectable, signal, inject } from '@angular/core';
import { GoogleGenAI, UsageMetadata } from "@google/genai";
import { AuthService } from './auth.service';
import { EnterpriseService } from './enterprise.service';
import { ChatMessage } from '../models/chat.model';
import { SystemConfig } from '../models/user.model';

export type AnalysisMode = 'fast' | 'standard' | 'deep';

@Injectable({
  providedIn: 'root'
})
export class GeminiService {
  private ai: GoogleGenAI | null = null;
  private authService = inject(AuthService);
  private enterpriseService = inject(EnterpriseService);

  private modelAnalysisConfigs: Record<AnalysisMode, any> = {
    fast: { thinkingConfig: { thinkingBudget: 0 } },
    standard: {},
    deep: { thinkingConfig: { thinkingBudget: 24576 } }
  };

  constructor() {
    try {
      if (process.env.API_KEY) {
        this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      } else {
        console.error("API_KEY environment variable not found.");
      }
    } catch (e) {
      console.error("Failed to initialize GoogleGenAI", e);
    }
  }

  isInitialized(): boolean {
    return !!this.ai;
  }

  async generateText(prompt: string, modelId: string = 'gemini-2.5-flash'): Promise<string> {
    if (!this.ai) {
        throw new Error("Lỗi: Gemini AI chưa được khởi tạo. Vui lòng kiểm tra API key.");
    }

    try {
        this.authService.checkAndIncrementUsage();
    } catch (e) {
        throw e;
    }
    
    let fullResponseText = '';
    let usageMetadata: UsageMetadata | null = null;

    try {
        const response = await this.ai.models.generateContent({
            model: modelId,
            contents: prompt
        });

        fullResponseText = response.text;
        usageMetadata = response.usageMetadata ?? null;
        return fullResponseText;

    } catch (error) {
        console.error('Error calling Gemini API (generateText):', error);
        const errorMessage = `Đã xảy ra lỗi khi phân tích dữ liệu. Lỗi: ${(error as Error).message}`;
         this.enterpriseService.logActivity({
          action_type: `analysis:generateText`,
          input_data: prompt,
          ai_response: `ERROR: ${errorMessage}`
        });
        throw new Error(errorMessage);
    } finally {
         if (fullResponseText) {
             this.enterpriseService.logActivity({
                action_type: `analysis:generateText`,
                input_data: prompt,
                ai_response: fullResponseText
            });
        }
        if (usageMetadata) {
            this.enterpriseService.logTokenUsage({
                module_name: 'generateText',
                model_used: modelId,
                input_tokens: usageMetadata.promptTokenCount ?? 0,
                output_tokens: usageMetadata.candidatesTokenCount ?? 0,
            });
        }
    }
  }

  async * getAnalysisStream(promptKey: string, data: any, mode: AnalysisMode, moduleKey: SystemConfig['config_key'], knowledgeContext: string = ''): AsyncGenerator<string> {
    if (!this.ai) {
        yield "Lỗi: Gemini AI chưa được khởi tạo. Vui lòng kiểm tra API key.";
        return;
    }

    try {
      this.authService.checkAndIncrementUsage();
    } catch (e) {
        yield (e as Error).message;
        return;
    }
    
    let contents: any;
    let stringInputDataForLogging: string;
    
    const modelName = this.enterpriseService.getModelForModule(moduleKey);
    const analysisConfig = this.modelAnalysisConfigs[mode];
    let finalConfig = { ...analysisConfig };
    
    const promptObject = this.enterpriseService.getPrompt(promptKey);

    if (promptKey === 'advisor_data_driven') {
        if (typeof data === 'string') {
          contents = data;
          stringInputDataForLogging = data;
        } else if (data && Array.isArray(data.parts)) {
          contents = { parts: data.parts };
          const textPart = data.parts.find((p: any) => p.text);
          stringInputDataForLogging = textPart ? textPart.text : 'Multipart request with files';
        } else {
          throw new Error('Invalid data format for advisor prompt');
        }
        
        if (promptObject?.responseSchema) {
            finalConfig.responseMimeType = "application/json";
            finalConfig.responseSchema = promptObject.responseSchema;
        }

    } else {
        const systemPrompt = promptObject?.content || 'Please analyze the following data.';
        const fullPrompt = `${knowledgeContext}\n---\n${systemPrompt}\nDưới đây là dữ liệu (định dạng JSON):\n${JSON.stringify(data, null, 2)}`;
        contents = fullPrompt;
        stringInputDataForLogging = JSON.stringify({ data, mode, knowledgeContext: knowledgeContext ? 'Yes' : 'No' });
    }

    let fullResponse = '';
    let usageMetadata: UsageMetadata | null = null;
    
    try {
      const responseStream = await this.ai.models.generateContentStream({
          model: modelName,
          contents: contents,
          config: finalConfig
      });

      for await (const chunk of responseStream) {
        const text = chunk.text;
        fullResponse += text;
        if (chunk.usageMetadata) {
            usageMetadata = chunk.usageMetadata;
        }
        yield text;
      }
    } catch (error) {
        console.error('Error calling Gemini API:', error);
        const errorMessage = `Đã xảy ra lỗi khi phân tích dữ liệu. Vui lòng thử lại. Lỗi: ${(error as Error).message}`;
        this.enterpriseService.logActivity({
          action_type: `analysis:${promptKey}`,
          input_data: stringInputDataForLogging,
          ai_response: `ERROR: ${errorMessage}`
        });
        yield errorMessage;
    } finally {
        if (fullResponse) {
             this.enterpriseService.logActivity({
                action_type: `analysis:${promptKey}`,
                input_data: stringInputDataForLogging,
                ai_response: fullResponse
            });
        }
        if (usageMetadata) {
            this.enterpriseService.logTokenUsage({
                module_name: promptKey, // Use promptKey for more granular logging
                model_used: modelName,
                input_tokens: usageMetadata.promptTokenCount ?? 0,
                output_tokens: usageMetadata.candidatesTokenCount ?? 0,
            });
        }
    }
  }

  async * sendChatMessageStream(systemInstruction: string, history: ChatMessage[], message: string, moduleKey: SystemConfig['config_key']): AsyncGenerator<string> {
    if (!this.ai) {
        yield "Lỗi: Gemini AI chưa được khởi tạo. Vui lòng kiểm tra API key.";
        return;
    }

    try {
        this.authService.checkAndIncrementUsage();
    } catch (e) {
        yield (e as Error).message;
        return;
    }

    const contents = [
        ...history.map(msg => ({ role: msg.role, parts: [{ text: msg.text }] })),
        { role: 'user', parts: [{ text: message }] }
    ];

    const modelName = this.enterpriseService.getModelForModule(moduleKey);
    let fullResponse = '';
    let usageMetadata: UsageMetadata | null = null;

    try {
        const responseStream = await this.ai.models.generateContentStream({
            model: modelName,
            contents: contents,
            config: { systemInstruction: systemInstruction }
        });

        for await (const chunk of responseStream) {
            const text = chunk.text;
            fullResponse += text;
            if (chunk.usageMetadata) {
                usageMetadata = chunk.usageMetadata;
            }
            yield text;
        }
    } catch (error) {
        console.error('Error calling Gemini API for chat:', error);
        const errorMessage = `Đã xảy ra lỗi khi chat. Lỗi: ${(error as Error).message}`;
        fullResponse = `ERROR: ${errorMessage}`;
        yield errorMessage;
    } finally {
        this.enterpriseService.logActivity({
            action_type: 'chatbot_message',
            input_data: message,
            ai_response: fullResponse
        });
        if (usageMetadata) {
            this.enterpriseService.logTokenUsage({
                module_name: 'Chatbot',
                model_used: modelName,
                input_tokens: usageMetadata.promptTokenCount ?? 0,
                output_tokens: usageMetadata.candidatesTokenCount ?? 0,
            });
        }
    }
  }
}