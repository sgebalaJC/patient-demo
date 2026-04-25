import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { intakeFormOperations } from '../../lib/firestore';
import { userOperations } from '../../lib/firestore';
import { FileText, ArrowRight, X } from 'lucide-react';
import logger from '../../lib/logger';

type BannerState = 'loading' | 'hidden' | 'needs_intake' | 'sent_back';

export const IntakeFormBanner: React.FC = () => {
  const { user, userProfile } = useAuth();
  const [state, setState] = useState<BannerState>('loading');

  useEffect(() => {
    if (!user || !userProfile || userProfile.role !== 'patient') {
      setState('hidden');
      return;
    }

    if (userProfile.intakeFormSkipped) {
      setState('hidden');
      return;
    }

    checkIntakeStatus();
  }, [user, userProfile]);

  const checkIntakeStatus = async () => {
    if (!user) return;

    try {
      const response = await intakeFormOperations.getPatientIntakeForm(user.uid);

      if (!response.success || !response.data) {
        // No form exists — prompt to start
        setState('needs_intake');
        return;
      }

      const status = response.data.status;

      if (status === 'completed' || status === 'approved') {
        setState('hidden');
        return;
      }

      // draft or in_progress — check if sent back by admin
      if (response.data.reviewNotes) {
        setState('sent_back');
      } else {
        setState('needs_intake');
      }
    } catch {
      setState('hidden');
    }
  };

  const handleSkip = () => {
    setState('hidden');
    if (user) {
      userOperations
        .updateUser(user.uid, { intakeFormSkipped: true })
        .catch((err) => logger.warn('Failed to persist intake-skip flag:', err));
    }
  };

  if (state === 'loading' || state === 'hidden') return null;

  const isSentBack = state === 'sent_back';

  return (
    <div className="relative flex items-center justify-between p-4 rounded-lg border bg-amber-50 border-amber-200">
      <Link to="/intake" className="flex items-center space-x-3 flex-1 min-w-0">
        <FileText className="h-5 w-5 text-amber-600 flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-amber-900">
            {isSentBack ? 'Your intake forms need attention' : 'Complete your intake forms'}
          </p>
          <p className="text-xs mt-0.5 text-amber-700">
            {isSentBack
              ? 'Your provider requested updates — please review and resubmit'
              : 'Patient information, medical history, consent forms, and membership agreement'}
          </p>
        </div>
        <ArrowRight className="h-4 w-4 flex-shrink-0 text-amber-600" />
      </Link>

      {!isSentBack && (
        <button
          onClick={(e) => {
            e.preventDefault();
            handleSkip();
          }}
          className="ml-3 p-1 rounded-full hover:bg-amber-100 text-amber-400 hover:text-amber-600 transition-colors flex-shrink-0"
          title="Skip for now"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
};
