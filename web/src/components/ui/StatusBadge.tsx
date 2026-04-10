import React from 'react';

interface StatusBadgeProps {
  label: string;
  colorClass: string;
  icon?: React.ReactNode;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ label, colorClass, icon }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
    {icon}
    {label}
  </span>
);
