import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, LucideIcon } from 'lucide-react';
import { Card } from './Card';

interface PageHeaderProps {
  backTo: string;
  icon: LucideIcon;
  iconColor?: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  backTo,
  icon: Icon,
  iconColor = 'bg-primary-100 text-primary-600',
  title,
  subtitle,
  action,
}) => {
  const [bgColor, textColor] = iconColor.split(' ');

  return (
    <Card className="p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-4 sm:space-y-0">
        <div className="flex items-center space-x-3 sm:space-x-4">
          <Link
            to={backTo}
            className="flex items-center text-primary-600 hover:text-primary-700 flex-shrink-0"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex items-center space-x-3 min-w-0">
            <div className={`${bgColor} p-2 sm:p-3 rounded-lg flex-shrink-0`}>
              <Icon className={`h-6 w-6 sm:h-8 sm:w-8 ${textColor}`} />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-bold text-secondary-900 truncate">{title}</h1>
              {subtitle && <p className="text-secondary-600 text-sm sm:text-base">{subtitle}</p>}
            </div>
          </div>
        </div>
        {action}
      </div>
    </Card>
  );
};
