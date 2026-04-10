import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button';
import { Card } from './Card';

interface PaginationBarProps {
  currentPage: number;
  pageSize: number;
  totalItems: number;
  hasMore: boolean;
  onPreviousPage: () => void;
  onNextPage: () => void;
  label?: string;
}

export const PaginationBar: React.FC<PaginationBarProps> = ({
  currentPage,
  pageSize,
  totalItems,
  hasMore,
  onPreviousPage,
  onNextPage,
  label = 'items',
}) => {
  void label; // prop kept for API compat
  if (totalItems <= pageSize && currentPage === 1) return null;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-center">
        <div className="flex items-center space-x-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={onPreviousPage}
            disabled={currentPage === 1}
            className="flex items-center"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Previous
          </Button>
          <span className="px-3 py-1 bg-primary-100 text-primary-800 rounded-md text-sm font-medium">
            {currentPage}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={onNextPage}
            disabled={!hasMore}
            className="flex items-center"
          >
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>
    </Card>
  );
};
