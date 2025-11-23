

import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { User, TrialTracking, SystemPrompt, KnowledgeBaseItem, SystemConfig, TokenUsageLog } from '../../models/user.model';
import { EnterpriseService } from '../../services/enterprise.service';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Component({
  selector: 'app-admin-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './admin-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminPanelComponent implements OnInit {
  authService = inject(AuthService);
  enterpriseService = inject(EnterpriseService);
  httpClient = inject(HttpClient);
  superAdminEmail = 'letuanlinh223@gmail.com';

  // Component state
  activeTab = signal<'members' | 'config' | 'prompts' | 'knowledge' | 'trials'>('members');

  // User list state
  allUsers = computed(() => this.authService.getUsers());
  pendingUsers = computed(() => this.allUsers().filter(u => u.status === 'pending'));
  managedUsers = computed(() => this.allUsers().filter(u => u.status !== 'pending').sort((a, b) => a.username.localeCompare(b.username)));
  
  // Reset password form state
  resetPasswordUsername = signal('');
  resetPasswordNew = signal('');
  resetPasswordSuccess = signal<string | null>(null);

  // Trial tracking state
  trialTrackings = signal<TrialTracking[]>([]);

  // Prompt Management state
  systemPrompts = signal<SystemPrompt[]>([]);
  promptSaveStatus = signal<{[key: string]: 'saved' | null}>({});
  selectedPromptKey = signal<string>('');
  selectedPrompt = computed(() => {
    const key = this.selectedPromptKey();
    if (!key) return null;
    return this.systemPrompts().find(p => p.key === key);
  });

  // Knowledge Base state
  knowledgeBaseItems = signal<KnowledgeBaseItem[]>([]);
  isUploading = signal(false);
  uploadError = signal<string | null>(null);

  // --- NEW: Config & Cost Tab State ---
  systemConfigs = signal<SystemConfig[]>([]);
  tokenUsageLogs = signal<TokenUsageLog[]>([]);
  configSaved = signal(false);
  availableModels = [
      "gemini-2.5-flash",
      "gemini-2.5-pro",
  ];
  useCustomModel = signal<Record<SystemConfig['config_key'], boolean>>({
    advisor_model: false,
    chat_model: false,
    analysis_model: false,
  });
  customModelValues = signal<Record<SystemConfig['config_key'], string>>({
    advisor_model: '',
    chat_model: '',
    analysis_model: '',
  });

  ngOnInit() {
    this.trialTrackings.set(this.authService.getTrialTrackingData());
    
    const prompts = this.enterpriseService.getPrompts();
    this.systemPrompts.set(prompts);
    if (prompts.length > 0) {
        this.selectedPromptKey.set(prompts[0].key);
    }

    this.knowledgeBaseItems.set(this.enterpriseService.getKnowledgeBase());
    
    const configs = this.enterpriseService.getSystemConfigs();
    this.systemConfigs.set(configs);
    this.initializeCustomModelUI(configs);

    this.tokenUsageLogs.set(this.enterpriseService.getTokenUsageLogs());
  }

  private initializeCustomModelUI(configs: SystemConfig[]): void {
      const useCustom: Record<SystemConfig['config_key'], boolean> = { advisor_model: false, chat_model: false, analysis_model: false };
      const customValues: Record<SystemConfig['config_key'], string> = { advisor_model: '', chat_model: '', analysis_model: '' };
      
      configs.forEach(config => {
          if (!this.availableModels.includes(config.model_id)) {
              useCustom[config.config_key] = true;
              customValues[config.config_key] = config.model_id;
          }
      });
      this.useCustomModel.set(useCustom);
      this.customModelValues.set(customValues);
  }

  // --- Cost Dashboard Computations ---
  costDashboardStats = computed(() => {
    const logs = this.tokenUsageLogs();
    const totalRequests = logs.length;
    const totalTokens = logs.reduce((acc, log) => acc + log.input_tokens + log.output_tokens, 0);
    const totalCost = logs.reduce((acc, log) => acc + log.estimated_cost, 0);

    const costByModel = logs.reduce<Record<string, number>>((acc, log) => {
        acc[log.model_used] = (acc[log.model_used] || 0) + log.estimated_cost;
        return acc;
    }, {});
    
    const costByDay = logs.reduce<Record<string, number>>((acc, log) => {
        const day = log.timestamp.split('T')[0];
        acc[day] = (acc[day] || 0) + log.estimated_cost;
        return acc;
    }, {});

    return { totalRequests, totalTokens, totalCost, costByModel, costByDay };
  });

  costByModelChartData = computed(() => {
      const { costByModel, totalCost } = this.costDashboardStats();
      if (totalCost === 0) return [];
      const colors = ['#4f46e5', '#10b981', '#f59e0b', '#6366f1', '#3b82f6'];
      return Object.entries(costByModel)
          .map(([model, cost], index) => ({
              model,
              cost: Number(cost),
              percentage: (Number(cost) / totalCost) * 100,
              color: colors[index % colors.length]
          }))
          .sort((a, b) => b.cost - a.cost);
  });

  costByDayChartData = computed(() => {
      const { costByDay } = this.costDashboardStats();
      const entries = Object.entries(costByDay).sort((a,b) => new Date(a[0]).getTime() - new Date(b[0]).getTime()).slice(-15); // Last 15 days
      const maxCost = Math.max(...entries.map(([, cost]) => Number(cost)), 0);
      return entries.map(([day, cost]) => ({
          day: new Date(day).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }),
          cost: Number(cost),
          height: maxCost > 0 ? (Number(cost) / maxCost) * 100 : 0
      }));
  });

  // --- User Management Methods ---
  updateVipLevel(username: string, event: Event) {
    const target = event.target as HTMLSelectElement;
    const level = target.value as User['vip_level'];
    this.authService.updateUserVipLevel(username, level);
  }
  deleteUser(username: string) {
    if (username === this.superAdminEmail) return;
    if (confirm(`Bạn có chắc chắn muốn XÓA VĨNH VIỄN người dùng "${username}" không? Hành động này không thể hoàn tác.`)) {
      this.authService.deleteUser(username);
    }
  }
  approveUser(username: string) { this.authService.approveUser(username); }
  rejectUser(username: string) {
     if (confirm(`Bạn có chắc chắn muốn TỪ CHỐI và xóa yêu cầu của "${username}" không?`)) {
      this.authService.deleteUser(username);
    }
  }
  toggleUserStatus(user: User) {
    if (user.username === this.superAdminEmail) return;
    const newStatus = user.status === 'active' ? 'blocked' : 'active';
    const action = newStatus === 'blocked' ? 'KHÓA' : 'MỞ KHÓA';
    if (confirm(`Bạn có chắc muốn ${action} tài khoản của "${user.username}" không?`)) {
        this.authService.updateUserStatus(user.username, newStatus);
    }
  }
  resetPassword() {
    this.resetPasswordSuccess.set(null);
    const username = this.resetPasswordUsername();
    const newPassword = this.resetPasswordNew();
    if (!username || !newPassword) return;
    this.authService.resetUserPassword(username, newPassword);
    this.resetPasswordSuccess.set(`Đã cập nhật mật khẩu thành công cho ${username}.`);
    this.resetPasswordNew.set('');
    setTimeout(() => this.resetPasswordSuccess.set(null), 4000);
  }

  // --- Settings Methods ---
  toggleCustomModel(key: SystemConfig['config_key']) {
      this.useCustomModel.update(current => {
          const isNowCustom = !current[key];
          // If we are switching FROM custom TO standard
          if (!isNowCustom) {
              const modelToSet = this.availableModels[0]; // Set to a safe default
              this.enterpriseService.updateSystemConfig(key, modelToSet);
              this.systemConfigs.set(this.enterpriseService.getSystemConfigs());
          }
          return {...current, [key]: isNowCustom};
      });
  }
  
  updateStandardModelSelection(key: SystemConfig['config_key'], event: Event) {
    const model_id = (event.target as HTMLSelectElement).value;
    this.enterpriseService.updateSystemConfig(key, model_id);
    this.systemConfigs.set(this.enterpriseService.getSystemConfigs());
  }

  updateCustomModelValue(key: SystemConfig['config_key'], event: Event) {
    const model_id = (event.target as HTMLInputElement).value;
    this.customModelValues.update(v => ({...v, [key]: model_id}));
    this.enterpriseService.updateSystemConfig(key, model_id);
    this.systemConfigs.set(this.enterpriseService.getSystemConfigs());
  }

  saveConfig() {
    this.configSaved.set(true);
    // Data is already saved by the service on update, this is just for UI feedback
    setTimeout(() => this.configSaved.set(false), 3000);
  }

  // --- Trial Tracking Methods ---
  resetTrial(id: string) {
      this.authService.resetTrialForId(id);
      this.trialTrackings.set(this.authService.getTrialTrackingData()); // Refresh data
  }

  // --- Prompt Management ---
  selectPrompt(event: Event) {
    this.selectedPromptKey.set((event.target as HTMLSelectElement).value);
  }

  updatePromptContent(key: string, event: Event) {
    const target = event.target as HTMLTextAreaElement;
    this.systemPrompts.update(prompts => 
      prompts.map(p => p.key === key ? { ...p, content: target.value } : p)
    );
  }
  savePrompt(key: string) {
    const prompt = this.systemPrompts().find(p => p.key === key);
    if (prompt) {
      this.enterpriseService.updatePrompt(key, prompt.content);
      this.promptSaveStatus.update(s => ({...s, [key]: 'saved'}));
      setTimeout(() => this.promptSaveStatus.update(s => ({...s, [key]: null})), 2000);
    }
  }

  // --- Knowledge Base Methods ---
  async handleFileUpload(event: Event) {
    const target = event.target as HTMLInputElement;
    const files = target.files;
    if (!files || files.length === 0) return;

    this.isUploading.set(true);
    this.uploadError.set(null);
    const currentUser = this.authService.currentUser();
    if (!currentUser) {
        this.uploadError.set("Lỗi: Không tìm thấy thông tin người dùng. Vui lòng đăng nhập lại.");
        this.isUploading.set(false);
        return;
    }

    const filePromises = Array.from(files).map(file => this.readFileAsDataUrl(file));

    try {
      const dataUrls = await Promise.all(filePromises);
      dataUrls.forEach((result, index) => {
        try {
            this.enterpriseService.addKnowledgeItem({
                fileName: files[index].name,
                mimeType: files[index].type || 'application/octet-stream',
                base64Data: result,
                uploaded_by: currentUser.username,
            });
        } catch (e) {
            // Re-throw to be caught by the outer catch block
            throw e;
        }
      });
      // Refresh the list from the service
      this.knowledgeBaseItems.set(this.enterpriseService.getKnowledgeBase());
    } catch (error) {
      this.uploadError.set((error as Error).message);
    } finally {
      this.isUploading.set(false);
      // Clear the file input for next upload
      target.value = ''; 
    }
  }

  private readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
      reader.readAsDataURL(file);
    });
  }

  deleteKnowledgeItem(id: number) {
    if (confirm('Bạn có chắc chắn muốn xóa tài liệu này khỏi cơ sở tri thức không?')) {
        this.enterpriseService.deleteKnowledgeItem(id);
        this.knowledgeBaseItems.set(this.enterpriseService.getKnowledgeBase());
    }
  }
}
