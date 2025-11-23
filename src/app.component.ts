

import { Component, ChangeDetectionStrategy, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from './services/data.service';
import { AuthService } from './services/auth.service';
import { FinancialsService } from './services/financials.service';
import { SidebarComponent } from './components/sidebar/sidebar.component';
import { OverviewComponent } from './components/overview/overview.component';
import { KocReportComponent } from './components/koc-report/koc-report.component';
import { VideoReportComponent } from './components/video-report/video-report.component';
import { DeepDiveComponent } from './components/deep-dive/deep-dive.component';
import { ProductReportComponent } from './components/product-report/product-report.component';
import { ChartsReportComponent } from './components/charts-report/charts-report.component';
import { ChatbotComponent } from './components/chatbot/chatbot.component';
import { LoginComponent } from './components/login/login.component';
import { AdminPanelComponent } from './components/admin-panel/admin-panel.component';
import { AiAdvisorComponent } from './components/ai-advisor/ai-advisor.component';
import { ActivityHistoryComponent } from './components/activity-history/activity-history.component';
import { ActionPlanComponent } from './components/action-plan/action-plan.component';
import { PnlReportComponent } from './components/pnl-report/pnl-report.component';
import { UploaderHubComponent } from './components/uploader-hub/uploader-hub.component';
import { GodModeComponent } from './components/god-mode/god-mode.component';

export type ViewType = 'overview' | 'product-report' | 'koc-report' | 'video-report' | 'deep-dive' | 'charts-report' | 'chatbot' | 'admin-panel' | 'ai-advisor' | 'activity-history' | 'action-plan' | 'pnl-report' | 'god-mode';
export type AppState = 'initial' | 'ads_only' | 'god_mode';


@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    CommonModule,
    SidebarComponent,
    OverviewComponent,
    KocReportComponent,
    VideoReportComponent,
    DeepDiveComponent,
    ProductReportComponent,
    ChartsReportComponent,
    ChatbotComponent,
    LoginComponent,
    AdminPanelComponent,
    AiAdvisorComponent,
    ActivityHistoryComponent,
    ActionPlanComponent,
    PnlReportComponent,
    UploaderHubComponent,
    GodModeComponent,
  ]
})
export class AppComponent {
  dataService = inject(DataService);
  authService = inject(AuthService);
  financialsService = inject(FinancialsService);
  
  currentView = signal<ViewType>('overview');

  appState = computed<AppState>(() => {
    if (this.financialsService.financialsLoaded()) {
      return 'god_mode';
    }
    if (this.dataService.dataLoaded()) {
      return 'ads_only';
    }
    return 'initial';
  });
  
  private previousState: AppState = this.appState();

  constructor() {
    effect(() => {
        const currentState = this.appState();
        // Transition into god_mode from another state
        if (currentState === 'god_mode' && this.previousState !== 'god_mode') {
            this.currentView.set('god-mode');
        }
        // Transition from a data-loaded state back to initial (e.g., reset)
        else if (currentState === 'initial' && this.previousState !== 'initial') {
            this.currentView.set('overview');
        }
        this.previousState = currentState;
    }, { allowSignalWrites: true });
  }

  onViewChange(view: ViewType): void {
    this.currentView.set(view);
  }
}