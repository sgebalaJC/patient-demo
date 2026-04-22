import React from 'react';
import { Card } from './Card';

interface FilterTab {
  key: string;
  label: string;
  count?: number;
}

interface FilterTabsProps {
  tabs: FilterTab[];
  activeKey: string;
  onChange: (key: string) => void;
}

export const FilterTabs: React.FC<FilterTabsProps> = ({ tabs, activeKey, onChange }) => {
  return (
    <Card className="p-6">
      <div className="flex space-x-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium border transition-colors ${
              activeKey === tab.key
                ? 'border-primary-600 text-primary-700 bg-primary-50'
                : 'border-transparent bg-secondary-100 text-secondary-700 hover:bg-secondary-200'
            }`}
          >
            {tab.label}{tab.count !== undefined ? ` (${tab.count})` : ''}
          </button>
        ))}
      </div>
    </Card>
  );
};
