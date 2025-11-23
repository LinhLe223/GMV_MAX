import { Component, ChangeDetectionStrategy, input, output, computed } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-pagination',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pagination.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaginationComponent {
  totalItems = input.required<number>();
  itemsPerPage = input.required<number>();
  currentPage = input.required<number>();
  uniqueId = input<string>(Math.random().toString(36).substring(2));

  pageChange = output<number>();
  itemsPerPageChange = output<number>();

  totalPages = computed(() => {
    const ipp = this.itemsPerPage();
    const total = this.totalItems();
    if (ipp >= total) return 1;
    return Math.ceil(total / ipp);
  });
  startItem = computed(() => this.totalItems() === 0 ? 0 : (this.currentPage() - 1) * this.itemsPerPage() + 1);
  endItem = computed(() => Math.min(this.currentPage() * this.itemsPerPage(), this.totalItems()));
  
  pages = computed(() => {
    const total = this.totalPages();
    const current = this.currentPage();
    const pageNumbers: (number | string)[] = [];

    if (total <= 7) {
      for (let i = 1; i <= total; i++) {
        pageNumbers.push(i);
      }
    } else {
      pageNumbers.push(1);
      if (current > 3) {
        pageNumbers.push('...');
      }
      if (current > 2) {
        pageNumbers.push(current - 1);
      }
      if (current !== 1 && current !== total) {
        pageNumbers.push(current);
      }
      if (current < total - 1) {
        pageNumbers.push(current + 1);
      }
      if (current < total - 2) {
        pageNumbers.push('...');
      }
      pageNumbers.push(total);
    }
    return [...new Set(pageNumbers)];
  });
  
  onItemsPerPageChange(event: Event) {
    const value = (event.target as HTMLSelectElement).value;
    this.itemsPerPageChange.emit(Number(value));
  }

  goToPage(page: number | string) {
    if (typeof page === 'number' && page >= 1 && page <= this.totalPages()) {
      this.pageChange.emit(page);
    }
  }
}
