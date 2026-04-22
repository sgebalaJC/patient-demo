import React from 'react';
import { Card } from './Card';
import { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  /** When true, renders without a Card wrapper (useful when already inside a Card). */
  inline?: boolean;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  action,
  inline = false,
}) => {
  const content = (
    <>
      {Icon && <Icon className="h-12 w-12 text-secondary-300 mx-auto mb-3" />}
      <h3 className="text-lg font-medium text-secondary-900 mb-2">{title}</h3>
      {description && <p className="text-secondary-600 mb-4">{description}</p>}
      {action}
    </>
  );

  if (inline) {
    return <div className="py-8 text-center">{content}</div>;
  }

  return (
    <Card className="p-8 text-center">{content}</Card>
  );
};
