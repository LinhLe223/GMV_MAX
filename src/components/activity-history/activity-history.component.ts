import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EnterpriseService } from '../../services/enterprise.service';
import { ActivityLog } from '../../models/user.model';

@Component({
  selector: 'app-activity-history',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './activity-history.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActivityHistoryComponent {
  enterpriseService = inject(EnterpriseService);
  
  logs = signal<ActivityLog[]>([]);
  
  startDate = signal('');
  endDate = signal('');

  constructor() {
    this.logs.set(this.enterpriseService.getActivityLogsForCurrentUser());
  }

  filteredLogs = computed(() => {
    let logs = this.logs();
    const start = this.startDate();
    const end = this.endDate();

    if (start) {
      logs = logs.filter(log => new Date(log.timestamp) >= new Date(start));
    }
    if (end) {
      // Add 1 day to end date to make it inclusive
      const endDateObj = new Date(end);
      endDateObj.setDate(endDateObj.getDate() + 1);
      logs = logs.filter(log => new Date(log.timestamp) < endDateObj);
    }
    
    return logs;
  });

  parseInputData(jsonString: string): any {
    try {
      return JSON.parse(jsonString);
    } catch (e) {
      return { raw: jsonString };
    }
  }

  objectKeys(obj: any): string[] {
    return Object.keys(obj);
  }
}
