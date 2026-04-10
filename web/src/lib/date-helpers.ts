import { Timestamp } from 'firebase/firestore';

type DateLike = Timestamp | Date | string | number | null | undefined;

/** Safely convert any date-like value to a Date */
export const toDate = (value: DateLike): Date => {
  if (!value) return new Date();
  if (value instanceof Date) return value;
  if (typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate();
  }
  return new Date(value as string | number);
};

/** "Mar 15, 2026, 2:30 PM" */
export const formatDateTime = (value: DateLike): string => {
  return toDate(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

/** "Mar 15, 2026" */
export const formatDate = (value: DateLike): string => {
  return toDate(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

/** "2:30 PM" */
export const formatTime = (value: DateLike): string => {
  return toDate(value).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

/** Shows time if today, otherwise date */
export const formatRelative = (value: DateLike): string => {
  const date = toDate(value);
  if (date.toDateString() === new Date().toDateString()) {
    return formatTime(date);
  }
  return formatDate(date);
};
