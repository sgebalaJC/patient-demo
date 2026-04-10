import React from 'react';
import { Card } from './Card';
import { LucideIcon } from 'lucide-react';

interface StatItem {
  icon: LucideIcon;
  iconColor: string;
  label: string;
  value: number | string;
}

interface StatsGridProps {
  items: StatItem[];
}

export const StatsGrid: React.FC<StatsGridProps> = ({ items }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
      {items.map((item, index) => {
        const [bgColor, textColor] = item.iconColor.split(' ');
        return (
          <Card key={index} className="p-6">
            <div className="flex items-center space-x-3">
              <div className={`${bgColor} p-3 rounded-lg`}>
                <item.icon className={`h-6 w-6 ${textColor}`} />
              </div>
              <div>
                <p className="text-sm font-medium text-secondary-600">{item.label}</p>
                <p className="text-lg font-semibold text-secondary-900">{item.value}</p>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
};
