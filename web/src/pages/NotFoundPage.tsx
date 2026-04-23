import React from 'react';
import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button } from '../components/ui/Button';

export const NotFoundPage: React.FC = () => {
  return (
    <div className="text-center py-16">
      <Compass className="h-16 w-16 text-primary-600 mx-auto mb-4" />
      <h1 className="text-2xl font-bold text-secondary-900 mb-2">Page not found</h1>
      <p className="text-secondary-600 mb-6 max-w-md mx-auto">
        The page you were looking for doesn't exist. It may have moved, or the
        link you followed might be broken.
      </p>
      <Link to="/">
        <Button variant="primary">Back to dashboard</Button>
      </Link>
    </div>
  );
};
