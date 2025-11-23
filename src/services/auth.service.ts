
import { Injectable, signal, computed, effect } from '@angular/core';
import { User, TrialTracking } from '../models/user.model';
import { DataService } from './data.service';
import { inject } from '@angular/core';

const USERS_STORAGE_KEY = 'tiktok_analyzer_users';
const SESSION_STORAGE_KEY = 'tiktok_analyzer_session';
const USAGE_LIMIT_KEY = 'tiktok_analyzer_usage_limit';
const TRIAL_TRACKING_KEY = 'tiktok_analyzer_trial_tracking';
const TRIAL_ID_KEY = 'tiktok_analyzer_trial_id';
const SUPER_ADMIN_EMAIL = 'letuanlinh223@gmail.com';
const TRIAL_LIMIT = 3;

const VIP_QUOTAS: Record<User['vip_level'], number> = {
  member: 1,
  vip1: 3,
  vip2: 5,
  admin: Infinity,
};

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private dataService = inject(DataService);

  // Signals for reactive state management
  currentUser = signal<User | null>(null);
  isLoggedIn = computed(() => !!this.currentUser());
  authError = signal<string | null>(null);
  usageLimit = signal<number>(50);
  
  // Trial mode state
  isTrialMode = signal(false);
  trialUsage = signal<{ count: number; limit: number }>({ count: 0, limit: TRIAL_LIMIT });
  private trialId: string | null = null;
  private trialTrackings = signal<TrialTracking[]>([]);
  
  private users = signal<User[]>([]);

  constructor() {
    this.loadUsersFromStorage();
    this.loadUsageLimitFromStorage();
    this.loadTrialTrackingsFromStorage();
    this.loadSession();

    effect(() => {
      localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(this.users()));
    });
    effect(() => {
      localStorage.setItem(USAGE_LIMIT_KEY, this.usageLimit().toString());
    });
     effect(() => {
      localStorage.setItem(TRIAL_TRACKING_KEY, JSON.stringify(this.trialTrackings()));
    });
  }

  private loadUsersFromStorage(): void {
    const usersJson = localStorage.getItem(USERS_STORAGE_KEY);
    let loadedUsers: User[] = usersJson ? JSON.parse(usersJson) : [];

    // Data migration for existing users
    loadedUsers = loadedUsers.map(user => ({
      ...user,
      status: user.status || 'active',
      vip_level: user.vip_level || 'member',
      files_uploaded_today: user.files_uploaded_today || 0,
      lastFileUploadDate: user.lastFileUploadDate || '1970-01-01',
    }));

    let superAdmin = loadedUsers.find(u => u.username === SUPER_ADMIN_EMAIL);
    const today = new Date().toISOString().split('T')[0];

    if (superAdmin) {
        superAdmin.role = 'admin';
        superAdmin.status = 'active';
        superAdmin.vip_level = 'admin';
    } else {
        superAdmin = {
            username: SUPER_ADMIN_EMAIL,
            password: 'superadminpassword',
            role: 'admin',
            status: 'active',
            dailyUsage: 0,
            lastActiveDate: today,
            vip_level: 'admin',
            files_uploaded_today: 0,
            lastFileUploadDate: today,
        };
        loadedUsers.push(superAdmin);
    }
    this.users.set(loadedUsers);
  }

  private loadUsageLimitFromStorage(): void {
    const limit = localStorage.getItem(USAGE_LIMIT_KEY);
    this.usageLimit.set(limit ? parseInt(limit, 10) : 50);
  }

  private loadTrialTrackingsFromStorage(): void {
    const trackingsJson = localStorage.getItem(TRIAL_TRACKING_KEY);
    this.trialTrackings.set(trackingsJson ? JSON.parse(trackingsJson) : []);
  }

  private loadSession(): void {
    const sessionUserJson = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (sessionUserJson) {
      const sessionUser = JSON.parse(sessionUserJson) as User;
      const storedUser = this.users().find(u => u.username === sessionUser.username);
      if (storedUser && storedUser.status === 'active') {
        this.currentUser.set(storedUser);
      }
    }
  }

  login(username: string, password: string): boolean {
    this.authError.set(null);
    const user = this.users().find(u => u.username === username);

    if (!user || user.password !== password) {
      this.authError.set('Tên đăng nhập hoặc mật khẩu không chính xác.');
      return false;
    }

    if (user.status === 'pending') {
        this.authError.set('Tài khoản của bạn đang chờ quản trị viên duyệt.');
        return false;
    }

    if (user.status === 'blocked') {
        this.authError.set('Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên.');
        return false;
    }

    const { password: _, ...userToStore } = user;
    this.currentUser.set(userToStore);
    this.isTrialMode.set(false);
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(userToStore));
    return true;
  }

  logout(): void {
    this.currentUser.set(null);
    this.isTrialMode.set(false);
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    this.dataService.reset();
  }

  registerUser(user: Omit<User, 'role' | 'status' | 'dailyUsage' | 'lastActiveDate' | 'vip_level' | 'files_uploaded_today' | 'lastFileUploadDate'>): { success: boolean; message: string } {
    if (this.users().some(u => u.username === user.username)) {
      return { success: false, message: 'Email này đã được sử dụng.' };
    }
    const today = new Date().toISOString().split('T')[0];
    const newUser: User = {
        ...user,
        role: 'user',
        status: 'pending',
        dailyUsage: 0,
        lastActiveDate: today,
        vip_level: 'member',
        files_uploaded_today: 0,
        lastFileUploadDate: today,
    };
    this.users.update(users => [...users, newUser]);
    return { success: true, message: `Đăng ký thành công! Vui lòng chờ Admin (${SUPER_ADMIN_EMAIL}) duyệt tài khoản.` };
  }

  // --- Trial Mode Methods ---
  startTrial(): void {
    let trialId = localStorage.getItem(TRIAL_ID_KEY);
    if (!trialId) {
        trialId = crypto.randomUUID();
        localStorage.setItem(TRIAL_ID_KEY, trialId);
    }
    this.trialId = trialId;

    const today = new Date().toISOString().split('T')[0];
    let tracking = this.trialTrackings().find(t => t.id === trialId);

    if (tracking && tracking.lastUsed !== today) {
        tracking.usageCount = 0; // Reset daily
        this.trialTrackings.update(trackings => [...trackings]);
    }
    
    if (!tracking) {
        tracking = { id: trialId, usageCount: 0, lastUsed: today };
        this.trialTrackings.update(trackings => [...trackings, tracking]);
    }
    
    this.trialUsage.set({ count: tracking.usageCount, limit: TRIAL_LIMIT });
    this.isTrialMode.set(true);
  }

  // --- Admin Methods ---
  getUsers(): User[] {
    return this.users().map(u => {
        const { password, ...userWithoutPassword } = u;
        return userWithoutPassword;
    });
  }

  addUser(user: Omit<User, 'dailyUsage' | 'lastActiveDate' | 'status' | 'vip_level' | 'files_uploaded_today' | 'lastFileUploadDate'>): boolean {
    if (this.users().some(u => u.username === user.username)) {
      return false;
    }
    const today = new Date().toISOString().split('T')[0];
    const newUser: User = { 
        ...user, 
        status: 'active', 
        dailyUsage: 0, 
        lastActiveDate: today,
        vip_level: 'member',
        files_uploaded_today: 0,
        lastFileUploadDate: today,
    };
    this.users.update(users => [...users, newUser]);
    return true;
  }
  
  resetUserPassword(username: string, newPassword: string):void {
      this.users.update(users => users.map(u => u.username === username ? {...u, password: newPassword } : u));
  }

  deleteUser(username: string): void {
    if (username === SUPER_ADMIN_EMAIL) return;
    this.users.update(users => users.filter(u => u.username !== username));
  }
  
  approveUser(username: string): void {
    this.users.update(users => users.map(u => u.username === username ? { ...u, status: 'active' } : u));
  }

  updateUserStatus(username: string, status: 'active' | 'blocked'): void {
    if (username === SUPER_ADMIN_EMAIL) return;
    this.users.update(users => users.map(u => u.username === username ? { ...u, status } : u));
  }

  updateUserVipLevel(username: string, vip_level: User['vip_level']): void {
    if (username === SUPER_ADMIN_EMAIL) return;
    this.users.update(users => users.map(u => u.username === username ? { ...u, vip_level } : u));
  }

  setUsageLimit(limit: number): void {
      this.usageLimit.set(Math.max(0, limit));
  }

  getTrialTrackingData(): TrialTracking[] {
      return this.trialTrackings();
  }

  resetTrialForId(id: string): void {
      this.trialTrackings.update(trackings => 
        trackings.map(t => t.id === id ? { ...t, usageCount: 0 } : t)
      );
  }

  // --- Rate Limiting ---
  canUploadFile(): boolean {
    const user = this.currentUser();
    if (!user) return false; // Or handle for trial users if they can upload
    
    const today = new Date().toISOString().split('T')[0];
    const userIndex = this.users().findIndex(u => u.username === user.username);
    if (userIndex === -1) return false;

    let userToUpdate = { ...this.users()[userIndex] };
    
    if (userToUpdate.lastFileUploadDate !== today) {
        userToUpdate.files_uploaded_today = 0;
        userToUpdate.lastFileUploadDate = today;
        this.users.update(users => {
            const newUsers = [...users];
            newUsers[userIndex] = userToUpdate;
            return newUsers;
        });
        this.currentUser.set({ ...this.currentUser()!, files_uploaded_today: 0, lastFileUploadDate: today });
    }

    const quota = VIP_QUOTAS[user.vip_level] || 1;
    return userToUpdate.files_uploaded_today < quota;
  }

  incrementFileUploadCount(): void {
    const user = this.currentUser();
    if (!user) return;
    
    const userIndex = this.users().findIndex(u => u.username === user.username);
    if (userIndex === -1) return;

    this.users.update(users => {
        const newUsers = [...users];
        const userToUpdate = { ...newUsers[userIndex] };
        userToUpdate.files_uploaded_today++;
        newUsers[userIndex] = userToUpdate;
        // Also update the current user signal
        this.currentUser.set({ ...this.currentUser()!, files_uploaded_today: userToUpdate.files_uploaded_today });
        return newUsers;
    });
  }

  checkAndIncrementUsage(): void {
    const today = new Date().toISOString().split('T')[0];
    
    if (this.isTrialMode()) {
        const tracking = this.trialTrackings().find(t => t.id === this.trialId);
        if (!tracking) throw new Error('Lỗi phiên dùng thử không hợp lệ.');
        
        if (tracking.lastUsed !== today) tracking.usageCount = 0;

        if (tracking.usageCount >= TRIAL_LIMIT) {
            this.trialUsage.set({ count: tracking.usageCount, limit: TRIAL_LIMIT });
            throw new Error(`Bạn đã hết ${TRIAL_LIMIT} lượt dùng thử miễn phí. Vui lòng Đăng ký tài khoản hoặc liên hệ Admin để tiếp tục sử dụng.`);
        }
        
        tracking.usageCount++;
        tracking.lastUsed = today;
        this.trialUsage.set({ count: tracking.usageCount, limit: TRIAL_LIMIT });
        this.trialTrackings.update(trackings => [...trackings]); // Trigger effect
        return;
    }

    const user = this.currentUser();
    if (!user) throw new Error('Yêu cầu đăng nhập để thực hiện hành động này.');

    const userIndex = this.users().findIndex(u => u.username === user.username);
    if (userIndex === -1) throw new Error('Người dùng không hợp lệ.');

    let userToUpdate = { ...this.users()[userIndex] };
    if (userToUpdate.lastActiveDate !== today) {
        userToUpdate.dailyUsage = 0;
        userToUpdate.lastActiveDate = today;
    }

    if (user.role !== 'admin' && userToUpdate.dailyUsage >= this.usageLimit()) {
        throw new Error(`Bạn đã hết lượt sử dụng AI hôm nay. Lượt dùng sẽ được làm mới vào ngày mai.`);
    }

    if(user.role !== 'admin') {
      userToUpdate.dailyUsage++;
    }
    
    this.users.update(currentUsers => {
        const newUsers = [...currentUsers];
        newUsers[userIndex] = userToUpdate;
        return newUsers;
    });

    const { password, ...userForSignal } = userToUpdate;
    this.currentUser.set(userForSignal);
  }
}
