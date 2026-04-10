import React from 'react';
import { Button } from './Button';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { PaginationState, PaginationControls } from '../../hooks/usePagination';

interface PaginationProps {
  state: PaginationState;
  controls: PaginationControls;
  showPageSizeSelector?: boolean;
  pageSizeOptions?: number[];
  className?: string;
}

export const Pagination: React.FC<PaginationProps> = ({
  state,
  controls,
  showPageSizeSelector = true,
  pageSizeOptions = [5, 10, 25, 50, 100],
  className = '',
}) => {
  if (state.totalItems === 0) {
    return null;
  }

  const startItem = (state.currentPage - 1) * state.pageSize + 1;
  const endItem = Math.min(state.currentPage * state.pageSize, state.totalItems);

  const getVisiblePages = () => {
    const delta = 2;
    const range = [];
    const rangeWithDots = [];

    const startPage = Math.max(2, state.currentPage - delta);
    const endPage = Math.min(state.totalPages - 1, state.currentPage + delta);

    for (let i = startPage; i <= endPage; i++) {
      range.push(i);
    }

    if (state.currentPage - delta > 2) {
      rangeWithDots.push(1, '...');
    } else {
      rangeWithDots.push(1);
    }

    rangeWithDots.push(...range);

    if (state.currentPage + delta < state.totalPages - 1) {
      rangeWithDots.push('...', state.totalPages);
    } else if (state.totalPages > 1) {
      rangeWithDots.push(state.totalPages);
    }

    return rangeWithDots;
  };

  return (
    <div className={`flex items-center justify-between bg-surface-card px-4 py-3 sm:px-6 ${className}`}>
      <div className="flex flex-1 justify-between sm:hidden">
        <Button
          variant="secondary"
          onClick={controls.prevPage}
          disabled={!state.hasPrevPage}
          size="sm"
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          onClick={controls.nextPage}
          disabled={!state.hasNextPage}
          size="sm"
        >
          Next
        </Button>
      </div>

      <div className="hidden sm:flex sm:flex-1 sm:items-center sm:justify-between">
        <div className="flex items-center space-x-4">
          <p className="text-sm text-secondary-700">
            Showing <span className="font-medium">{startItem}</span> to{' '}
            <span className="font-medium">{endItem}</span> of{' '}
            <span className="font-medium">{state.totalItems}</span> results
          </p>

          {showPageSizeSelector && (
            <div className="flex items-center space-x-2">
              <label htmlFor="pageSize" className="text-sm text-secondary-700">
                Show:
              </label>
              <select
                id="pageSize"
                value={state.pageSize}
                onChange={(e) => controls.setPageSize(parseInt(e.target.value))}
                className="rounded-md border border-secondary-300 text-sm focus:border-primary-500 focus:ring-primary-500"
              >
                {pageSizeOptions.map(size => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <nav className="isolate inline-flex -space-x-px rounded-md shadow-sm" aria-label="Pagination">
          <Button
            variant="ghost"
            onClick={() => controls.goToPage(1)}
            disabled={!state.hasPrevPage}
            size="sm"
            className="relative inline-flex items-center rounded-l-md px-2 py-2 ring-1 ring-inset ring-secondary-300 hover:bg-secondary-50 focus:z-20"
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>

          <Button
            variant="ghost"
            onClick={controls.prevPage}
            disabled={!state.hasPrevPage}
            size="sm"
            className="relative inline-flex items-center px-2 py-2 ring-1 ring-inset ring-secondary-300 hover:bg-secondary-50 focus:z-20"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          {getVisiblePages().map((page, index) => (
            <React.Fragment key={index}>
              {page === '...' ? (
                <span className="relative inline-flex items-center px-4 py-2 text-sm font-semibold text-secondary-700 ring-1 ring-inset ring-secondary-300">
                  ...
                </span>
              ) : (
                <Button
                  variant={page === state.currentPage ? "primary" : "ghost"}
                  onClick={() => controls.goToPage(page as number)}
                  size="sm"
                  className="relative inline-flex items-center px-4 py-2 text-sm font-semibold ring-1 ring-inset ring-secondary-300 focus:z-20"
                >
                  {page}
                </Button>
              )}
            </React.Fragment>
          ))}

          <Button
            variant="ghost"
            onClick={controls.nextPage}
            disabled={!state.hasNextPage}
            size="sm"
            className="relative inline-flex items-center px-2 py-2 ring-1 ring-inset ring-secondary-300 hover:bg-secondary-50 focus:z-20"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>

          <Button
            variant="ghost"
            onClick={() => controls.goToPage(state.totalPages)}
            disabled={!state.hasNextPage}
            size="sm"
            className="relative inline-flex items-center rounded-r-md px-2 py-2 ring-1 ring-inset ring-secondary-300 hover:bg-secondary-50 focus:z-20"
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </nav>
      </div>
    </div>
  );
};