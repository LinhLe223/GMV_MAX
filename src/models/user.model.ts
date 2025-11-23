
export interface User {
  username: string; // email
  password?: string; // Stored in localStorage, but not in memory/signals
  role: 'admin' | 'user';
  status: 'pending' | 'active' | 'blocked';
  dailyUsage: number;
  lastActiveDate: string; // Format: YYYY-MM-DD
  vip_level: 'member' | 'vip1' | 'vip2' | 'admin';
  files_uploaded_today: number;
  lastFileUploadDate: string; // YYYY-MM-DD
}

export interface TrialTracking {
  id: string; // The UUID
  usageCount: number;
  lastUsed: string; // YYYY-MM-DD
}

export interface SystemPrompt {
  key: string;
  content: string;
  description: string;
  responseSchema?: any;
}

export interface KnowledgeBaseItem {
  id: number;
  fileName: string;
  mimeType: string;
  base64Data: string;
  uploaded_by: string; // user email
  uploaded_at: string;
}

export interface ActivityLog {
  id: number;
  user_email: string;
  action_type: string;
  input_data: string; // JSON string of the input
  ai_response: string;
  timestamp: string; // ISO string
}

export interface CampaignPlan {
  id: number;
  user_email: string;
  plan_name: string;
  target_gmv: number;
  target_roi: number;
  total_budget: number;
  ai_response_content: string; // The detailed plan from AI as a JSON string
  status: 'planning' | 'running' | 'completed' | 'reviewed';
  created_at: string; // ISO string
  actual_result_file_content?: string; // User-uploaded results content
  ai_review?: string; // AI analysis of feedback
}

export interface SystemConfig {
  config_key: 'advisor_model' | 'chat_model' | 'analysis_model';
  model_id: string;
  description: string;
}

export interface TokenUsageLog {
  id: number;
  timestamp: string; // ISO string
  module_name: string;
  model_used: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost: number; // USD
}