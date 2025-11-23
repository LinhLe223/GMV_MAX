

import { Component, ChangeDetectionStrategy, input, output, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ViewType } from '../../app.component';
import { DataService } from '../../services/data.service';
import { AuthService } from '../../services/auth.service';
import { FinancialsService } from '../../services/financials.service';

@Component({
  selector: 'app-sidebar',
  templateUrl: './sidebar.component.html',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarComponent {
  currentView = input.required<ViewType>();
  viewChange = output<ViewType>();
  dataService = inject(DataService);
  authService = inject(AuthService);
  financialsService = inject(FinancialsService);

  menuItems = computed(() => {
    const dataLoaded = this.dataService.dataLoaded();
    const financialsLoaded = this.financialsService.financialsLoaded();
    const isLoggedIn = this.authService.isLoggedIn();
    const user = this.authService.currentUser();
    
    const items: {id: ViewType, name: string, icon: string, requiresData: boolean, show: boolean}[] = [
      // God mode special view
      { id: 'god-mode', name: '🏆 GOD MODE (Lợi Nhuận Thực)', icon: 'M10.34 1.942a.75.75 0 01.928 1.056l-.132.221a8.995 8.995 0 00-2.31 5.922c0 2.213.882 4.293 2.375 5.823a.75.75 0 11-1.12 1.004A10.495 10.495 0 015.25 9.141c0-2.836 1.12-5.463 2.966-7.39l.118-.173a.75.75 0 011.056-.035zM12.966 16.095a.75.75 0 11-1.056-1.12l.221-.132a8.995 8.995 0 005.922-2.31c2.213 0 4.293-.882 5.823-2.375a.75.75 0 111.004 1.12A10.495 10.495 0 0114.859 18.75c-2.836 0-5.463-1.12-7.39-2.966l-.173-.118a.75.75 0 01-.035-1.056zM8.98 5.75a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-1.06L12.69 11.5H3.75a.75.75 0 010-1.5h8.94L8.98 6.81a.75.75 0 010-1.06z', requiresData: false, show: financialsLoaded },
      
      // Data-dependent reports
      { id: 'overview', name: 'Tổng quan (Ads)', icon: 'M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z', requiresData: false, show: true },
      { id: 'pnl-report', name: '💰 P&L & Lợi Nhuận', icon: 'M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.75A.75.75 0 013 4.5h.75m0 0h.75A.75.75 0 015.25 6v.75m0 0v-.75A.75.75 0 014.5 5.25h-.75M6 15V7.5a2.25 2.25 0 012.25-2.25h3.75a2.25 2.25 0 012.25 2.25V15m-9.75-4.5h9.75', requiresData: false, show: financialsLoaded },
      { id: 'product-report', name: 'Báo cáo Sản phẩm', icon: 'M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9.75l-9-5.25', requiresData: true, show: true },
      { id: 'charts-report', name: 'Biểu đồ & Phân tích', icon: 'M7.5 14.25v-4.5m3.75 4.5v-1.5m3.75 1.5v-3m3.75 3v-6', requiresData: true, show: true },
      { id: 'koc-report', name: 'Báo cáo KOC', icon: 'M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m-7.5-2.952A11.933 11.933 0 006 14.154M-6.22 16.24a9.094 9.094 0 01-3.741-.479 3 3 0 014.682-2.72M-11.25-11.25a3 3 0 013-3h7.5a3 3 0 013 3v7.5a3 3 0 01-3 3h-7.5a3 3 0 01-3-3v-7.5z', requiresData: true, show: true },
      { id: 'video-report', name: 'Báo cáo Video', icon: 'M15.75 10.5l4.72-4.72a.75.75 0 000-1.06l-1.5-1.5a.75.75 0 00-1.06 0L13.5 7.69V6.75a.75.75 0 00-.75-.75h-3a.75.75 0 00-.75.75v3.75c0 .414.336.75.75.75h3.75a.75.75 0 00.75-.75v-.75z', requiresData: true, show: true },
      { id: 'deep-dive', name: 'Phân tích chi tiết', icon: 'M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12', requiresData: true, show: true },
      
      // Data-independent tools
      { id: 'ai-advisor', name: 'Cố vấn Triển khai', icon: 'M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z', requiresData: false, show: isLoggedIn },
      { id: 'action-plan', name: 'Kế hoạch Hành động', icon: 'M3.75 9.75h16.5a.75.75 0 01.75.75v6a.75.75 0 01-.75.75H3.75a.75.75 0 01-.75-.75v-6a.75.75 0 01.75-.75zM3.75 8.25A2.25 2.25 0 016 6h12a2.25 2.25 0 012.25 2.25v6A2.25 2.25 0 0118 18H6a2.25 2.25 0 01-2.25-2.25v-6zM12 1.5a.75.75 0 01.75.75v.75h-1.5V2.25A.75.75 0 0112 1.5zM12 3a.75.75 0 00-1.5 0v.75h1.5V3z', requiresData: false, show: isLoggedIn },
      { id: 'chatbot', name: 'AI Chatbot', icon: 'M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193l-3.72.16c-1.104.048-2.03.92-2.03 2.028v.928a2.25 2.25 0 01-2.25 2.25h-1.5a2.25 2.25 0 01-2.25-2.25v-.928c0-1.108-.927-1.98-2.03-2.028l-3.72-.16A2.25 2.25 0 013 14.894V10.608c0-.97.616-1.813 1.5-2.097L6.75 8.324a2.25 2.25 0 012.25-2.25h6a2.25 2.25 0 012.25 2.25l2.25.187z', requiresData: true, show: true },
      { id: 'activity-history', name: 'Lịch sử Hoạt động', icon: 'M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6-2.292m0 0v14.25', requiresData: false, show: isLoggedIn },
      { id: 'admin-panel', name: 'Admin Panel', icon: 'M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527c.447-.318 1.02-.276 1.364.165l.772.98c.345.44.302 1.018-.104 1.363l-.737.527c-.35.25-.541.69-.541 1.135v1.44c0 .445.191.885.541 1.135l.737.527c.406.345.45 1.021.104 1.363l-.772.98c-.345.44-.917.483-1.364.165l-.737-.527c-.35-.25-.807-.272-1.205-.108-.396.166-.71.506-.78.93l-.149.894c-.09.542-.56.94-1.11-.94h-1.093c-.55 0-1.02-.398-1.11-.94l-.149-.894c-.07-.424-.384-.764-.78-.93-.398-.164-.855-.142-1.205-.108l-.737.527c-.447-.318-1.02.276-1.364-.165l-.772-.98c-.345-.44-.302-1.018.104-1.363l.737.527c.35-.25.541.69-.541 1.135v-1.44c0-.445-.191-.885-.541-1.135l-.737-.527c-.406-.345-.45-1.021.104-1.363l.772.98c.345-.44.917-.483-1.364-.165l-.737.527c-.35.25-.807-.272-1.205-.108-.396-.166-.71.506-.78.93l-.149.894zM12 15.75a3.75 3.75 0 100-7.5 3.75 3.75 0 000 7.5z', requiresData: false, show: user?.role === 'admin' },
    ];

    return items.filter(item => {
        if (!item.show) return false;
        if (item.requiresData && !dataLoaded) return false;
        return true;
    });
  });

  remainingUsage = computed(() => {
    const user = this.authService.currentUser();
    if (!user) return 0;
    if (user.role === 'admin') return Infinity;
    const limit = this.authService.usageLimit();
    return Math.max(0, limit - user.dailyUsage);
  });

  trialUsage = computed(() => {
      const usage = this.authService.trialUsage();
      if (!usage) return { remaining: 0, limit: 0};
      return {
          remaining: Math.max(0, usage.limit - usage.count),
          limit: usage.limit
      };
  });

  changeView(view: ViewType) {
    this.viewChange.emit(view);
  }

  logout() {
    this.authService.logout();
    this.financialsService.reset();
  }
}