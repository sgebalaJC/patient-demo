import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { intakeFormOperations } from '../../lib/firestore';
import { userOperations } from '../../lib/firestore';
import { FileText, ArrowRight, X } from 'lucide-react';

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
      userOperations.updateUser(user.uid, { intakeFormSkipped: true } as any).catch(() => {});
    }
  };

  if (state === 'loading' || state === 'hidden') return null;

  const isSentBack = state === 'sent_back';

  return (
    <div className={`relative flex items-center justify-between p-4 rounded-lg border ${
      isSentBack
        ? 'bg-amber-50 border-amber-200'
        : 'bg-amber-50 border-amber-200'
    }`}>
      <Link
        to="/intake"
        className="flex items-center space-x-3 flex-1 min-w-0"
      >
        <div className={`p-2 rounded-lg flex-shrink-0 ${
          isSentBack ? 'bg-amber-100' : 'bg-amber-100'
        }`}>
          <FileText className={`h-5 w-5 ${
            isSentBack ? 'text-amber-600' : 'text-amber-600'
          }`} />
        </div>
        <div className="min-w-0">
          <p className={`text-sm font-medium ${
            isSentBack ? 'text-amber-900' : 'text-amber-900'
          }`}>
            {isSentBack
              ? 'Your intake forms need attention'
              : 'Complete your intake forms'}
          </p>
          <p className={`text-xs mt-0.5 ${
            isSentBack ? 'text-amber-700' : 'text-amber-700'
          }`}>
            {isSentBack
              ? 'Your provider requested updates — please review and resubmit'
              : 'Patient information, medical history, consent forms, and membership agreement'}
          </p>
        </div>
        <ArrowRight className={`h-4 w-4 flex-shrink-0 ${
          isSentBack ? 'text-amber-600' : 'text-amber-600'
        }`} />
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
