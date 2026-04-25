import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { Timestamp } from 'firebase/firestore';
import { userOperations } from '../../lib/firestore';
import { BRANDING } from '../../config/branding';
import logger from '../../lib/logger';
import type { User } from '../../types';
import {
  Heart,
  Calendar,
  MessageSquare,
  Pill,
  FileText,
  Headphones,
  X,
  ChevronRight,
  ChevronLeft,
  SkipForward,
} from 'lucide-react';

const TUTORIAL_STEPS = [
  {
    id: 'welcome',
    title: `Welcome to ${BRANDING.shortName}`,
    description:
      'Your personal healthcare hub. Manage appointments, message your care team, request prescription refills, and more — all in one place.',
    icon: Heart,
    route: '/dashboard',
  },
  {
    id: 'appointments',
    title: 'Book Appointments',
    description:
      'View available time slots and schedule visits with your provider. You can also reschedule or cancel upcoming appointments.',
    icon: Calendar,
    route: '/appointments',
  },
  {
    id: 'messages',
    title: 'Message Your Care Team',
    description:
      'Send secure messages with file attachments to your provider. Get responses directly in the app — no phone tag needed.',
    icon: MessageSquare,
    route: '/messages',
  },
  {
    id: 'refills',
    title: 'Request Prescription Refills',
    description:
      'Submit refill requests for your medications. Track the status of each request and get notified when they are ready.',
    icon: Pill,
    route: '/refills',
  },
  {
    id: 'intake',
    title: 'Complete Intake Forms',
    description:
      'Fill out your patient information, medical history, and consent forms — all digitally, at your own pace.',
    icon: FileText,
    route: '/intake',
  },
  {
    id: 'support',
    title: `Meet ${BRANDING.patientAgent.name}, Your AI Assistant`,
    description:
      `Have questions about the practice, appointment hours, or how things work? ${BRANDING.patientAgent.name} can help you find answers instantly.`,
    icon: Headphones,
    route: '/support',
  },
];

// Impersonation must not mutate the impersonated patient's tutorial state —
// an admin clicking "Skip" shouldn't dismiss the tutorial for the real user.
// Keep the dismissal tab-local in that case.
const SESSION_DISMISS_KEY = 'tutorial-dismissed-in-session';

export const OnboardingTutorial: React.FC = () => {
  const { user, userProfile, impersonating } = useAuth();
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const [completed, setCompleted] = useState<string[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);

  useEffect(() => {
    if (!userProfile || userProfile.role !== 'patient') return;
    if (userProfile.tutorialDismissedAt) return;
    if (sessionStorage.getItem(SESSION_DISMISS_KEY)) return;

    const done = userProfile.tutorialCompletedSections || [];
    const skip = userProfile.tutorialSkippedSections || [];
    setCompleted(done);
    setSkipped(skip);

    // Find first incomplete step
    const allHandled = new Set([...done, ...skip]);
    const firstIncomplete = TUTORIAL_STEPS.findIndex(
      (s) => !allHandled.has(s.id)
    );

    if (firstIncomplete === -1) {
      // All steps done — auto-dismiss
      if (!userProfile.tutorialDismissedAt) {
        dismiss();
      }
      return;
    }

    setCurrentStep(firstIncomplete);
    setVisible(true);
  }, [
    userProfile?.tutorialDismissedAt,
    userProfile?.role,
    userProfile?.tutorialCompletedSections?.length,
    userProfile?.tutorialSkippedSections?.length,
  ]);

  const persist = (updates: Partial<User>) => {
    if (!user) return;
    // Skip the Firestore write while impersonating — writing to the real
    // patient's doc would pollute their tutorial state and the rules may
    // deny it outright, leaving the popup to reappear on every navigation.
    if (impersonating) return;
    userOperations
      .updateUser(user.uid, updates)
      .catch((err) => logger.warn('Failed to persist tutorial state:', err));
  };

  const completeStep = () => {
    const step = TUTORIAL_STEPS[currentStep];
    const next = [...completed, step.id];
    setCompleted(next);
    persist({ tutorialCompletedSections: next });
    advance();
  };

  const skipStep = () => {
    const step = TUTORIAL_STEPS[currentStep];
    const next = [...skipped, step.id];
    setSkipped(next);
    persist({ tutorialSkippedSections: next });
    advance();
  };

  const advance = () => {
    if (currentStep < TUTORIAL_STEPS.length - 1) {
      setCurrentStep((s) => s + 1);
    } else {
      dismiss();
    }
  };

  const dismiss = () => {
    setVisible(false);
    sessionStorage.setItem(SESSION_DISMISS_KEY, '1');
    persist({ tutorialDismissedAt: Timestamp.fromDate(new Date()) });
  };

  const goToFeature = () => {
    const step = TUTORIAL_STEPS[currentStep];
    // Mark step complete but don't dismiss — tutorial resumes on return
    const next = [...completed, step.id];
    setCompleted(next);
    persist({ tutorialCompletedSections: next });
    setVisible(false);
    if (step.route !== '/dashboard') {
      navigate(step.route);
    }
  };

  if (!visible) return null;

  const step = TUTORIAL_STEPS[currentStep];
  const Icon = step.icon;
  const isFirst = currentStep === 0;
  const isLast = currentStep === TUTORIAL_STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={dismiss}
      />

      {/* Card */}
      <div className="relative bg-surface-card rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
        {/* Close button */}
        <button
          onClick={dismiss}
          className="absolute top-4 right-4 p-1 rounded-full hover:bg-secondary-100 text-secondary-400 hover:text-secondary-600 transition-colors z-10"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Content */}
        <div className="px-8 pt-10 pb-6 text-center">
          {/* Icon — always uses the brand theme so colors don't clash per-step */}
          <div className="mx-auto w-16 h-16 rounded-2xl bg-primary-100 flex items-center justify-center mb-6">
            <Icon className="h-8 w-8 text-primary-600" />
          </div>

          {/* Title */}
          <h2 className="text-xl font-bold text-secondary-900 mb-3">
            {step.title}
          </h2>

          {/* Description */}
          <p className="text-secondary-600 text-sm leading-relaxed mb-6">
            {step.description}
          </p>

          {/* Step dots */}
          <div className="flex justify-center gap-1.5 mb-6">
            {TUTORIAL_STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all ${
                  i === currentStep
                    ? 'w-6 bg-primary-500'
                    : i < currentStep
                      ? 'w-1.5 bg-primary-300'
                      : 'w-1.5 bg-secondary-200'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="px-8 pb-8 flex items-center justify-between gap-3">
          {/* Left: Skip or Back */}
          <div className="flex gap-2">
            {!isFirst && (
              <button
                onClick={() => setCurrentStep((s) => s - 1)}
                className="flex items-center gap-1 text-sm text-secondary-500 hover:text-secondary-700 transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </button>
            )}
          </div>

          {/* Right: Skip + Next/Try it */}
          <div className="flex gap-2">
            <button
              onClick={skipStep}
              className="flex items-center gap-1 px-3 py-2 text-sm text-secondary-500 hover:text-secondary-700 transition-colors"
            >
              <SkipForward className="h-3.5 w-3.5" />
              Skip
            </button>

            {currentStep === 0 ? (
              <button
                onClick={completeStep}
                className="flex items-center gap-1.5 px-5 py-2.5 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors"
              >
                Get Started
                <ChevronRight className="h-4 w-4" />
              </button>
            ) : isLast ? (
              <button
                onClick={goToFeature}
                className="flex items-center gap-1.5 px-5 py-2.5 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors"
              >
                Let's Go!
              </button>
            ) : (
              <button
                onClick={goToFeature}
                className="flex items-center gap-1.5 px-4 py-2.5 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors"
              >
                Try It
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Step counter */}
        <div className="text-center pb-4">
          <span className="text-xs text-secondary-400">
            {currentStep + 1} of {TUTORIAL_STEPS.length}
          </span>
        </div>
      </div>
    </div>
  );
};
