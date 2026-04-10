import React from 'react';
import { Clock, LogOut } from 'lucide-react';
import { Button } from './Button';
import { signOut } from '../../lib/firebase';

export const PendingApproval: React.FC = () => {
  return (
    <div className="min-h-screen bg-secondary-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-surface-card rounded-2xl shadow-sm border border-secondary-200 p-8 text-center">
        <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto mb-6">
          <Clock className="h-8 w-8 text-amber-500" />
        </div>
        <h1 className="text-2xl font-bold text-secondary-900 mb-3">Account Pending Approval</h1>
        <p className="text-secondary-600 mb-2">
          Your account has been created successfully.
        </p>
        <p className="text-secondary-500 text-sm mb-8">
          A member of our team will review and activate your account shortly.
          You'll be able to access the app once your account is approved.
        </p>
        <Button
          variant="secondary"
          onClick={() => signOut()}
          className="flex items-center justify-center mx-auto"
        >
          <LogOut className="h-4 w-4 mr-2" />
          Sign Out
        </Button>
      </div>
    </div>
  );
};
