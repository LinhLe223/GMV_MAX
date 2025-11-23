
import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './login.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent {
  authService = inject(AuthService);
  
  // View state
  activeTab = signal<'login' | 'signup'>('login');
  showForgotPasswordInfo = signal(false);

  // Login form state
  username = signal('');
  password = signal('');
  isLoading = signal(false);

  // Registration form state
  newUsername = signal('');
  newPassword = signal('');
  confirmPassword = signal('');
  registrationError = signal<string | null>(null);
  registrationSuccess = signal<string | null>(null);
  isRegistering = signal(false);

  login(): void {
    this.isLoading.set(true);
    this.registrationSuccess.set(null); // Clear success message if trying to log in
    this.showForgotPasswordInfo.set(false);
    setTimeout(() => {
      this.authService.login(this.username(), this.password());
      this.isLoading.set(false);
    }, 500);
  }

  register(): void {
    this.isRegistering.set(true);
    this.registrationError.set(null);
    this.registrationSuccess.set(null);
    this.showForgotPasswordInfo.set(false);

    if (this.newPassword() !== this.confirmPassword()) {
      this.registrationError.set('Mật khẩu nhập lại không khớp.');
      this.isRegistering.set(false);
      return;
    }
    
    if (!this.newUsername() || !this.newPassword()) {
       this.registrationError.set('Vui lòng nhập đầy đủ thông tin.');
       this.isRegistering.set(false);
       return;
    }

    setTimeout(() => {
      const result = this.authService.registerUser({
        username: this.newUsername(),
        password: this.newPassword(),
      });
      
      if (result.success) {
        this.registrationSuccess.set(result.message);
        this.activeTab.set('login'); // Switch back to login tab
        this.username.set(this.newUsername()); // Pre-fill username for convenience
        this.newUsername.set('');
        this.newPassword.set('');
        this.confirmPassword.set('');
      } else {
        this.registrationError.set(result.message);
      }
      this.isRegistering.set(false);
    }, 500);
  }

  startTrial(): void {
    this.authService.startTrial();
  }

  setTab(tab: 'login' | 'signup'): void {
    this.activeTab.set(tab);
    // Clear errors when switching tabs
    this.authService.authError.set(null);
    this.registrationError.set(null);
    this.showForgotPasswordInfo.set(false);
  }
}
