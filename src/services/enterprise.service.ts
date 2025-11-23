



import { Injectable, signal, effect } from '@angular/core';
import { SystemPrompt, KnowledgeBaseItem, ActivityLog, CampaignPlan, SystemConfig, TokenUsageLog } from '../models/user.model';
import { AuthService } from './auth.service';
import { inject } from '@angular/core';

const PROMPTS_KEY = 'enterprise_prompts';
const KNOWLEDGE_KEY = 'enterprise_knowledge';
const ACTIVITY_LOG_KEY = 'enterprise_activity_log';
const CAMPAIGN_PLAN_KEY = 'enterprise_campaign_plan';
const SYSTEM_CONFIG_KEY = 'enterprise_system_config';
const TOKEN_LOG_KEY = 'enterprise_token_usage_logs';
const AI_MODES_CONFIG_KEY = 'enterprise_ai_modes_config';

export interface AiModeConfig { model: string; prompt: string; }

const ADVISOR_SCHEMA = {
    type: 'OBJECT',
    properties: {
      productStrategy: {
        type: 'ARRAY',
        description: 'Top 3-5 sản phẩm chủ lực cần tập trung.',
        items: {
          type: 'OBJECT',
          properties: {
            productName: { type: 'STRING', description: 'Tên của sản phẩm/chiến dịch.' },
            reasoning: { type: 'STRING', description: 'Lý do tại sao sản phẩm này được chọn để nhân rộng.' },
            suggestion: { type: 'STRING', description: 'Gợi ý hành động cụ thể, ví dụ: tạo combo mới.' }
          },
          required: ['productName', 'reasoning', 'suggestion']
        }
      },
      creativeScalingPlan: {
        type: 'ARRAY',
        description: 'Danh sách chi tiết ít nhất 20-50 video với các hành động cụ thể.',
        items: {
          type: 'OBJECT',
          properties: {
            videoId: { type: 'STRING' },
            videoTitle: { type: 'STRING' },
            roi: { type: 'NUMBER' },
            gmv: { type: 'NUMBER' },
            cost: { type: 'NUMBER' },
            action: { type: 'STRING', description: "Hành động cần thực hiện: 'SCALE_X5', 'SCALE_X3', 'MONITOR', 'OPTIMIZE_COST', hoặc 'PAUSE'." },
            reasoning: { type: 'STRING', description: 'Lý do ngắn gọn cho hành động này.' }
          },
          required: ['videoId', 'videoTitle', 'roi', 'gmv', 'cost', 'action', 'reasoning']
        }
      },
      summary: {
        type: 'OBJECT',
        description: 'Tóm tắt tổng thể và các ước tính.',
        properties: {
          estimatedDailyBudget: { type: 'NUMBER', description: 'Ngân sách ước tính hàng ngày bằng VNĐ.' },
          knowledgeSummary: { type: 'STRING', description: 'Tóm tắt ngắn gọn những hiểu biết chính rút ra từ các tệp cơ sở kiến thức được cung cấp.' },
          overallStrategy: { type: 'STRING', description: 'Một đoạn văn kết luận về chiến lược tổng thể.' }
        },
        required: ['estimatedDailyBudget', 'knowledgeSummary', 'overallStrategy']
      },
      financialProjection: {
        type: 'OBJECT',
        description: 'Dự toán tài chính và lộ trình chiến dịch.',
        properties: {
          scaleUpBudgetSuggestion: { type: 'STRING', description: 'Đề xuất tăng ngân sách cho các video "Super Win".' },
          boosterAdsSuggestion: { type: 'STRING', description: 'Đề xuất ngân sách "mồi" cho các video tiềm năng.' },
          roadmapTable: {
            type: 'ARRAY',
            description: 'Bảng tổng hợp lộ trình tài chính cho toàn bộ chiến dịch.',
            items: {
              type: 'OBJECT',
              properties: {
                metric: { type: 'STRING', description: 'Chỉ số tài chính.' },
                current: { type: 'STRING', description: 'Giá trị trung bình hiện tại.' },
                newTarget: { type: 'STRING', description: 'Mục tiêu mới được đề xuất.' },
                notes: { type: 'STRING', description: 'Ghi chú về chiến lược GMV Max.' }
              },
              required: ['metric', 'current', 'newTarget', 'notes']
            }
          }
        },
        required: ['scaleUpBudgetSuggestion', 'boosterAdsSuggestion', 'roadmapTable']
      }
    },
    required: ['productStrategy', 'creativeScalingPlan', 'summary', 'financialProjection']
};

const ADVISOR_PROMPT_CONTENT = `[VAI TRÒ & NHIỆM VỤ]
Bạn là một Giám đốc Tăng trưởng GMV quảng cáo TikTok đẳng cấp thế giới. Nhiệm vụ của bạn là phân tích dữ liệu chiến dịch lịch sử và cơ sở kiến thức để tạo ra một kế hoạch tăng trưởng dựa trên dữ liệu và có thể hành động. Đầu ra của bạn BẮT BUỘC phải là một đối tượng JSON tuân thủ schema được cung cấp.

[TRẠNG THÁI DỮ LIỆU HIỆN TẠI]
- File Ads: {has_ads}
- File Order: {has_order}
- File Kho: {has_stock}

[NHIỆM VỤ CỐT LÕI DỰA TRÊN DỮ LIỆU]
1.  Nếu chỉ có file Ads: Tư vấn tối ưu GMV, CTR, Bid giá (như cũ). Bỏ qua các yếu tố về lợi nhuận.
2.  Nếu có đủ 3 file (GOD MODE):
    - BỎ QUA các chỉ số ảo (GMV, View).
    - TẬP TRUNG 100% vào Lợi Nhuận Ròng (Net Profit).
    - Vạch trần các KOC/Sản phẩm đang "ăn mòn" lợi nhuận (Lỗ thực).
    - Đề xuất cắt giảm ngân sách cho các mã có tỷ lệ hoàn/hủy cao.

[DỮ LIỆU ĐẦU VÀO 1: TÓM TẮT HIỆU SUẤT SẢN PHẨM]
{summary_products_table}

[DỮ LIỆU ĐẦU VÀO 2: TOP VIDEO TIỀM NĂNG (NGUỒN SÁNG TẠO)]
{summary_videos_table}

{financial_context}

[CƠ SỞ KIẾN THỨC]
(Bạn sẽ nhận được các tệp đính kèm. Hãy phân tích chúng để tìm xu hướng thị trường, công thức sáng tạo hiệu quả, hoặc chi tiết khuyến mãi. Tóm tắt những hiểu biết chính trong trường 'knowledgeSummary' của phản hồi.)

[MỤC TIÊU CỦA NGƯỜI DÙNG]
- Mục tiêu GMV: {target_gmv} VND
- Mục tiêu ROI: {target_roi}
- Thời gian Chiến dịch: {duration} ngày

[YÊU CẦU CỦA BẠN]
Tạo một phản hồi JSON tuân thủ chính xác schema đã chỉ định.

PHẦN 1: **Chiến lược Sản phẩm**: Chọn 3-5 "Sản phẩm Anh hùng" từ dữ liệu. Cung cấp lý do rõ ràng và một gợi ý chiến lược cho mỗi sản phẩm.
PHẦN 2: **Kế hoạch nhân bản Sáng tạo**: Đây là phần quan trọng nhất. Liệt kê TỐI THIỂU 20-50 video từ kho video tiềm năng nếu dữ liệu cho phép. Đối với mỗi video, hãy gán một kế hoạch hành động cụ thể ('SCALE_X5', 'MONITOR', v.v.) và một lý do ngắn gọn. ĐỪNG chỉ liệt kê một vài cái. Người dùng cần một danh sách toàn diện để chiếm lĩnh thị trường.
PHẦN 3: **Tóm tắt chung**: Cung cấp ước tính ngân sách, tóm tắt thông tin từ cơ sở kiến thức và đưa ra một cái nhìn tổng quan chiến lược cuối cùng.

### PHẦN 4: DỰ TOÁN TÀI CHÍNH & LỘ TRÌNH
Dựa trên kiến thức GMV Max (Scale ngân sách khi ROI đạt chuẩn) và dữ liệu hiệu quả của các Video/Sản phẩm đã chọn, hãy tính toán cụ thể:

1. **Ngân Sách Tăng Cường:**
   - Với các Video "Super Win" (ROI > {target_roi}), đề xuất tăng bao nhiêu % ngân sách so với trung bình cũ?
   - Số tiền cụ thể cần tăng thêm mỗi ngày là bao nhiêu? (Cung cấp dưới dạng chuỗi trong 'scaleUpBudgetSuggestion')

2. **Quảng Cáo Mồi:**
   - Đề xuất ngân sách chạy "Mồi" (Booster) cho các video tiềm năng để test máy học. (Cung cấp dưới dạng chuỗi trong 'boosterAdsSuggestion')

3. **BẢNG TỔNG HỢP LỘ TRÌNH ({duration} Ngày):**
   Hãy lập bảng chốt số liệu tài chính cho toàn bộ chiến dịch này trong 'roadmapTable':

   | Chỉ số (Metric) | Hiện tại (Avg cũ) | ĐỀ XUẤT MỚI (Target) | Ghi chú Chiến lược GMV Max |
   |---|---|---|---|
   | **ROI Mục Tiêu** | {current_avg_roi} | **{target_roi}** | Giữ ROI ổn định để vít volume |
   | **Ngân sách Ngày** | ... VNĐ | **... VNĐ** | Tăng chi tiêu vào nhóm Win |
   | **Tổng Ngân sách ({duration} ngày)** | - | **... VNĐ** | (Ngân sách ngày x Số ngày) |
   | **Dự kiến Doanh thu (GMV)** | - | **... VNĐ** | (Tổng ngân sách x ROI Target) |

**Yêu cầu tính toán:**
- Hãy tính toán con số thực tế dựa trên ROI kỳ vọng.
- Ví dụ: Nếu người dùng muốn GMV 1 tỷ trong 7 ngày với ROI 5.0 -> Tổng ngân sách phải là 200 triệu -> Ngân sách ngày ~28.5 triệu.
- Đừng đưa ra con số ảo. Hãy dùng phép tính ngược từ Mục tiêu GMV của người dùng.

[CRITICAL LANGUAGE RULE - LUẬT NGÔN NGỮ BẮT BUỘC]
1. **OUTPUT LANGUAGE:** TRẢ LỜI 100% BẰNG TIẾNG VIỆT NAM.
2. **Table Headers (Tiêu đề bảng):** Tuyệt đối KHÔNG dùng tiếng Anh. Phải dịch sang tiếng Việt.
   - Sai: | Video ID | Action Plan | Budget |
   - Đúng: | ID Video | Hành động cụ thể | Ngân sách/Ngày |
3. **Terminology (Thuật ngữ):** Giữ nguyên các từ viết tắt chuyên ngành Marketing (ROI, GMV, CTR, CPC) nhưng nội dung giải thích phải là tiếng Việt.
4. **Tone:** Chuyên nghiệp, gãy gọn, dùng từ ngữ của người làm Marketing tại Việt Nam (Ví dụ: dùng từ "Vít ads", "Thầu", "Cắn tiền", "Tối ưu").

[REMINDER]
Nếu bạn trả lời bằng tiếng Anh, hệ thống sẽ bị lỗi. Hãy chắc chắn mọi chữ cái xuất hiện (trừ tên riêng/ID) đều là Tiếng Việt.`;

const ADVISOR_FEEDBACK_PROMPT = `Bạn là Giám đốc Kiểm soát Chất lượng.

Đây là Kế hoạch tôi đã đề xuất:
{original_plan}

Đây là Kết quả thực tế chạy được:
{actual_result_summary}

Hãy so sánh và đánh giá một cách chuyên nghiệp, đi thẳng vào vấn đề:

1.  **Tỷ lệ hoàn thành KPI:** Mức độ hoàn thành so với mục tiêu GMV và ROI ban đầu là bao nhiêu %?
2.  **Phân tích Hiệu quả:** Video/Sản phẩm nào thực sự hiệu quả như dự đoán? Yếu tố nào gây bất ngờ (thành công hoặc thất bại)?
3.  **Bài học Rút ra:** Dựa trên sự khác biệt giữa kế hoạch và thực tế, đâu là bài học cốt lõi cho chiến dịch lần tới? (Ví dụ: "Mẫu content A hoạt động tốt hơn dự kiến", "KOC B không phù hợp với sản phẩm này", "Cần tăng ngân sách cho các video có CTR cao ngay từ đầu").`;

const DEFAULT_PROMPTS: SystemPrompt[] = [
    { key: 'overview_analyzer', description: 'Prompt dùng cho trang Tổng quan', content: 'Phân tích tổng quan hiệu suất quảng cáo TikTok dựa trên các chỉ số tổng hợp và top sản phẩm sau.'},
    { key: 'product_report_analyzer', description: 'Prompt dùng cho trang Báo cáo Sản phẩm (tổng quan)', content: 'Phân tích tổng quan hiệu suất các sản phẩm dựa trên dữ liệu sau.'},
    { key: 'product_detail_analyzer', description: 'Prompt dùng cho trang Báo cáo Sản phẩm (chi tiết)', content: 'Phân tích chi tiết sản phẩm được chọn dựa trên dữ liệu video, đặc biệt chú ý đến bộ lọc ROI.'},
    { key: 'koc_report_analyzer', description: 'Prompt dùng cho trang Báo cáo KOC (tổng quan)', content: 'Phân tích hiệu suất của các KOC/KOL dựa trên bảng xếp hạng tổng hợp sau.'},
    { key: 'koc_detail_analyzer', description: 'Prompt dùng cho trang Báo cáo KOC (chi tiết)', content: 'Phân tích chi tiết hiệu suất của KOC được chọn dựa trên danh sách video của họ.'},
    { key: 'video_report_analyzer', description: 'Prompt dùng cho trang Báo cáo Video', content: 'Phân tích hiệu suất của các video quảng cáo dựa trên bảng dữ liệu sau.'},
    { key: 'deep_dive_analyzer', description: 'Prompt dùng cho trang Phân tích Chi tiết', content: 'Phân tích chi tiết hiệu suất của sản phẩm, KOC và video dựa trên dữ liệu drill-down sau.'},
    { key: 'charts_report_analyzer', description: 'Prompt dùng cho trang Biểu đồ & Phân tích', content: 'Phân tích sự phân bổ và hiệu quả của các KOC cho sản phẩm được chọn dựa trên dữ liệu sau.'},
    { key: 'chatbot_context', description: 'Prompt hệ thống (system instruction) cho AI Chatbot', content: 'Bạn là một chuyên gia phân tích dữ liệu quảng cáo TikTok Ads. Người dùng đã tải lên một tệp dữ liệu và đây là bản tóm tắt các chỉ số chính. Nhiệm vụ của bạn là trả lời các câu hỏi của người dùng về dữ liệu này. Hãy sử dụng dữ liệu tóm tắt trên làm bối cảnh chính để trả lời. Luôn trả lời bằng tiếng Việt một cách thân thiện và chuyên nghiệp.'},
    { 
        key: 'advisor_data_driven', 
        description: 'Cố vấn AI: Quy trình Tối ưu hóa Dựa trên Dữ liệu (JSON Output)', 
        content: ADVISOR_PROMPT_CONTENT,
        responseSchema: ADVISOR_SCHEMA
    },
    {
        key: 'advisor_feedback_analyzer',
        description: 'Cố vấn AI: Phân tích và đánh giá kết quả chiến dịch so với kế hoạch.',
        content: ADVISOR_FEEDBACK_PROMPT
    }
];

const DEFAULT_SYSTEM_CONFIG: SystemConfig[] = [
    { config_key: 'advisor_model', model_id: 'gemini-2.5-flash', description: 'Model dùng cho Cố vấn Chiến lược (yêu cầu chất lượng cao).'},
    { config_key: 'analysis_model', model_id: 'gemini-2.5-flash', description: 'Model dùng cho các tác vụ phân tích nhanh trong các báo cáo.'},
    { config_key: 'chat_model', model_id: 'gemini-2.5-flash', description: 'Model dùng cho AI Chatbot (yêu cầu tốc độ nhanh).'},
];

const DEFAULT_AI_MODES_CONFIG: Record<'fast' | 'standard' | 'deep', AiModeConfig> = {
  fast: { model: 'gemini-2.5-flash', prompt: 'Từ dữ liệu tóm tắt, hãy phân tích nhanh (dưới 100 từ) về xu hướng chính, điểm mạnh và điểm yếu nổi bật nhất. Đưa ra 1 gợi ý hành động quan trọng nhất.' },
  standard: { model: 'gemini-2.5-pro', prompt: 'Phân tích chi tiết hiệu quả các KOC dựa trên dữ liệu tóm tắt và top 5 KOC. Đánh giá sự chênh lệch giữa GMV và Lợi nhuận thực. Đề xuất chiến lược cho từng nhóm KOC trong ma trận BCG.' },
  deep: { model: 'gemini-2.5-pro', prompt: 'Bạn là chuyên gia phân tích tài chính. Dựa vào dữ liệu P&L, hãy phân tích chuyên sâu về sức khỏe tài chính của chiến dịch. Đưa ra dự báo về dòng tiền, điểm hòa vốn, và các rủi ro tiềm ẩn. Đề xuất một chiến lược phân bổ ngân sách chi tiết để tối đa hóa Lợi Nhuận Ròng trong 30 ngày tới.' }
};


const PRICING: Record<string, { input: number; output: number }> = {
    "gemini-1.5-flash": { "input": 0.075 / 1000000, "output": 0.3 / 1000000 },
    "gemini-1.5-pro": { "input": 3.5 / 1000000, "output": 10.5 / 1000000 },
    "gemini-2.5-flash": { "input": 0.075 / 1000000, "output": 0.3 / 1000000 }, // Assuming same as 1.5 for now
    "gemini-2.5-pro": { "input": 3.5 / 1000000, "output": 10.5 / 1000000 }, // Assuming same as 1.5 for now
    "gemini-2.0-flash-exp": { "input": 0, "output": 0 }
};

@Injectable({
  providedIn: 'root'
})
export class EnterpriseService {
  private authService = inject(AuthService);

  private prompts = signal<SystemPrompt[]>([]);
  private knowledgeBase = signal<KnowledgeBaseItem[]>([]);
  private activityLogs = signal<ActivityLog[]>([]);
  private campaignPlans = signal<CampaignPlan[]>([]);
  private systemConfigs = signal<SystemConfig[]>([]);
  private tokenUsageLogs = signal<TokenUsageLog[]>([]);
  private aiModesConfig = signal<Record<'fast' | 'standard' | 'deep', AiModeConfig>>(DEFAULT_AI_MODES_CONFIG);
  
  // State for persisting AI advisor plan across views
  activeAdvisorPlan = signal<any | null>(null);

  constructor() {
    this.loadFromStorage();
    
    effect(() => this.saveToLocalStorage(PROMPTS_KEY, this.prompts()));
    effect(() => this.saveToLocalStorage(ACTIVITY_LOG_KEY, this.activityLogs()));
    effect(() => this.saveToLocalStorage(CAMPAIGN_PLAN_KEY, this.campaignPlans()));
    effect(() => this.saveToLocalStorage(SYSTEM_CONFIG_KEY, this.systemConfigs()));
    effect(() => this.saveToLocalStorage(TOKEN_LOG_KEY, this.tokenUsageLogs()));
    effect(() => this.saveToLocalStorage(AI_MODES_CONFIG_KEY, this.aiModesConfig()));
  }

  private saveToLocalStorage(key: string, data: any): void {
    try {
        localStorage.setItem(key, JSON.stringify(data));
    } catch(e) {
        console.error(`Error saving to localStorage (key: ${key}):`, e);
    }
  }

  private loadFromStorage() {
    // Prompts
    const promptsJson = localStorage.getItem(PROMPTS_KEY);
    if (promptsJson) {
        let loadedPrompts = JSON.parse(promptsJson) as SystemPrompt[];
        DEFAULT_PROMPTS.forEach(defaultPrompt => {
            if (!loadedPrompts.find(p => p.key === defaultPrompt.key)) {
                loadedPrompts.push(defaultPrompt);
            }
        });
      this.prompts.set(loadedPrompts);
    } else {
      this.prompts.set(DEFAULT_PROMPTS);
    }
    
    // Knowledge
    const knowledgeJson = localStorage.getItem(KNOWLEDGE_KEY);
    this.knowledgeBase.set(knowledgeJson ? JSON.parse(knowledgeJson) : []);

    // Activity Logs
    const activityLogJson = localStorage.getItem(ACTIVITY_LOG_KEY);
    this.activityLogs.set(activityLogJson ? JSON.parse(activityLogJson) : []);

    // Campaign Plans
    const campaignPlanJson = localStorage.getItem(CAMPAIGN_PLAN_KEY);
    this.campaignPlans.set(campaignPlanJson ? JSON.parse(campaignPlanJson) : []);
    
    // System Config
    const systemConfigJson = localStorage.getItem(SYSTEM_CONFIG_KEY);
    if (systemConfigJson) {
        this.systemConfigs.set(JSON.parse(systemConfigJson));
    } else {
        this.systemConfigs.set(DEFAULT_SYSTEM_CONFIG);
    }

    // Token Usage Logs
    const tokenLogJson = localStorage.getItem(TOKEN_LOG_KEY);
    this.tokenUsageLogs.set(tokenLogJson ? JSON.parse(tokenLogJson) : []);

    // AI Modes Config
    const aiModesConfigJson = localStorage.getItem(AI_MODES_CONFIG_KEY);
    if (aiModesConfigJson) {
        this.aiModesConfig.set(JSON.parse(aiModesConfigJson));
    } else {
        this.aiModesConfig.set(DEFAULT_AI_MODES_CONFIG);
    }
  }

  private truncate(str: string | undefined | null, maxLength: number): string {
    if (!str) return '';
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength) + `... [TRUNCATED from ${str.length} chars]`;
  }

  private truncateOptional(str: string | undefined | null, maxLength: number): string | undefined {
      if (!str) return undefined;
      if (str.length <= maxLength) return str;
      return str.substring(0, maxLength) + `... [TRUNCATED from ${str.length} chars]`;
  }

  // --- Prompts ---
  getPrompts(): SystemPrompt[] { return this.prompts(); }
  getPrompt(key: string): SystemPrompt | undefined { return this.prompts().find(p => p.key === key); }
  updatePrompt(key: string, content: string) { this.prompts.update(prompts => prompts.map(p => p.key === key ? { ...p, content } : p)); }
  
  // --- Knowledge Base ---
  getKnowledgeBase(): KnowledgeBaseItem[] { return this.knowledgeBase(); }
  addKnowledgeItem(item: Omit<KnowledgeBaseItem, 'id' | 'uploaded_at'>) {
    const newItem: KnowledgeBaseItem = { 
        ...item, 
        id: Date.now(),
        uploaded_at: new Date().toISOString()
    };
    const newItems = [...this.knowledgeBase(), newItem];
    try {
        localStorage.setItem(KNOWLEDGE_KEY, JSON.stringify(newItems));
        this.knowledgeBase.set(newItems);
    } catch (e) { throw new Error("Dung lượng lưu trữ đã đầy. Vui lòng xóa bớt tài liệu cũ."); }
  }
  deleteKnowledgeItem(id: number) {
    const newItems = this.knowledgeBase().filter(item => item.id !== id);
    this.saveToLocalStorage(KNOWLEDGE_KEY, newItems);
    this.knowledgeBase.set(newItems);
  }
  
  // --- Activity Log ---
  logActivity(log: Omit<ActivityLog, 'id' | 'timestamp' | 'user_email'>) {
    const user = this.authService.currentUser();
    if (!user) return;
    const newLog: ActivityLog = {
      ...log,
      id: Date.now(),
      user_email: user.username,
      timestamp: new Date().toISOString(),
      input_data: this.truncate(log.input_data, 2000),
      ai_response: this.truncate(log.ai_response, 5000)
    };
    this.activityLogs.update(logs => [newLog, ...logs].slice(0, 50));
  }
  getActivityLogsForCurrentUser(): ActivityLog[] {
      const user = this.authService.currentUser();
      if (!user) return [];
      return this.activityLogs().filter(log => log.user_email === user.username);
  }
  
  // --- Campaign Plans ---
  addCampaignPlan(plan: Omit<CampaignPlan, 'id' | 'created_at' | 'status' | 'user_email'>): CampaignPlan {
    const user = this.authService.currentUser();
    if (!user) throw new Error("User not logged in");
    const newPlan: CampaignPlan = {
      ...plan,
      id: Date.now(),
      user_email: user.username,
      created_at: new Date().toISOString(),
      status: 'planning',
      ai_response_content: this.truncate(plan.ai_response_content, 100000),
    };
    this.campaignPlans.update(plans => [newPlan, ...plans]);
    return newPlan;
  }
  getCampaignPlansForCurrentUser(): CampaignPlan[] {
     const user = this.authService.currentUser();
     if (!user) return [];
     return this.campaignPlans().filter(plan => plan.user_email === user.username);
  }
  updateCampaignPlan(updatedPlan: CampaignPlan) {
    this.campaignPlans.update(plans => 
        plans.map(p => {
            if (p.id !== updatedPlan.id) return p;
            const planToSave = { ...updatedPlan };
            planToSave.ai_response_content = this.truncate(planToSave.ai_response_content, 100000);
            planToSave.actual_result_file_content = this.truncateOptional(planToSave.actual_result_file_content, 50000);
            planToSave.ai_review = this.truncateOptional(planToSave.ai_review, 20000);
            return planToSave;
        })
    );
  }

  // --- System Config & Token Logging ---
  getSystemConfigs(): SystemConfig[] { return this.systemConfigs(); }

  updateSystemConfig(key: SystemConfig['config_key'], model_id: string) {
      this.systemConfigs.update(configs => configs.map(c => c.config_key === key ? { ...c, model_id } : c));
  }

  getModelForModule(moduleKey: SystemConfig['config_key']): string {
      const config = this.systemConfigs().find(c => c.config_key === moduleKey);
      return config?.model_id || 'gemini-2.5-flash'; // Fallback
  }

  getTokenUsageLogs(): TokenUsageLog[] { return this.tokenUsageLogs(); }

  logTokenUsage(log: Omit<TokenUsageLog, 'id' | 'timestamp' | 'estimated_cost'>) {
      const pricing = PRICING[log.model_used] || { input: 0, output: 0 };
      const cost = (log.input_tokens * pricing.input) + (log.output_tokens * pricing.output);
      
      const newLog: TokenUsageLog = {
          ...log,
          id: Date.now(),
          timestamp: new Date().toISOString(),
          estimated_cost: cost
      };
      this.tokenUsageLogs.update(logs => [newLog, ...logs].slice(0, 200));
  }

  // --- AI Modes Config ---
  getAiModesConfig(): Record<'fast' | 'standard' | 'deep', AiModeConfig> {
    return this.aiModesConfig();
  }

  updateAiModesConfig(newConfig: Record<'fast' | 'standard' | 'deep', AiModeConfig>) {
    this.aiModesConfig.set(newConfig);
  }
}