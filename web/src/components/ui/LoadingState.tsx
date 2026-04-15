import React from 'react';
import { Card } from './Card';

interface LoadingStateProps {
  /** Title shown below the spinner, e.g. "Loading appointments…" */
  title: string;
  /** Optional secondary line under the title. */
  description?: string;
  /** When true, renders without a Card wrapper (useful when already inside a Card). */
  inline?: boolean;
}

/**
 * Standard loading placeholder — mirrors `<EmptyState>`'s shape so a Card
 * swapping between loading / empty / populated stays the same size.
 *
 * Use this everywhere instead of ad-hoc spinner+text combos so loading
 * affordances stay visually consistent across the app.
 */
export const LoadingState: React.FC<LoadingStateProps> = ({ title, description, inline = false }) => {
  const content = (
    <>
      <div className="mx-auto mb-3 flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-primary-600 border-t-transparent animate-spin" />
      </div>
      <h3 className="text-lg font-medium text-secondary-900 mb-2">{title}</h3>
      {description && <p className="text-secondary-600">{description}</p>}
    </>
  );

  if (inline) {
    return <div className="py-8 text-center">{content}</div>;
  }

  return <Card className="p-8 text-center">{content}</Card>;
};
