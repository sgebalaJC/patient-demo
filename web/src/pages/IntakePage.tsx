import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { PatientInfoSection } from '../components/intake/PatientInfoSection';
import { MedicalHistorySection } from '../components/intake/MedicalHistorySection';
import { FamilyHistorySection } from '../components/intake/FamilyHistorySection';
import { ConsentFormSection } from '../components/intake/ConsentFormSection';

import { useAuth } from '../hooks/useAuth';
import { intakeFormOperations } from '../lib/firestore';
import { PatientIntakeForm } from '../types';
import {
    ArrowLeft,
    FileText,
    CheckCircle2,
    Circle,
    User,
    Heart,
    Users,
    FileCheck,
} from 'lucide-react';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import logger from "../lib/logger";

const formSections = [
  {
    id: 'patient-info',
    title: 'Patient Information',
    icon: User,
    description: 'Personal, emergency, and insurance details'
  },
  {
    id: 'medical-history',
    title: 'Medical History',
    icon: Heart,
    description: 'Medical background and health information'
  },
  {
    id: 'family-history',
    title: 'Family History',
    icon: Users,
    description: 'Family illness and hereditary conditions'
  },
  {
    id: 'consent-form',
    title: 'Consent for Treatment',
    icon: FileCheck,
    description: 'Treatment and privacy consents'
  },
];

export const IntakePage: React.FC = () => {
  const { user, userProfile } = useAuth();
  const navigate = useNavigate();
  const [intakeForm, setIntakeForm] = useState<PatientIntakeForm | null>(null);
  const [currentSection, setCurrentSection] = useState<string>('patient-info');
  const [loading, setLoading] = useState(true);
  const [savingSection, setSavingSection] = useState(false);

  useEffect(() => {
    if (user && (userProfile?.role === 'patient' || userProfile?.role === 'admin')) {
      fetchOrCreateIntakeForm();
    }
  }, [user, userProfile]);

  const fetchOrCreateIntakeForm = async () => {
    if (!user) return;

    try {
      setLoading(true);
      let response = await intakeFormOperations.getPatientIntakeForm(user.uid);

      if (!response.success || !response.data) {
        // Create new intake form
        const createResponse = await intakeFormOperations.createIntakeForm(user.uid);
        if (createResponse.success) {
          setIntakeForm(createResponse.data!);
        }
      } else {
        setIntakeForm(response.data);
        setCurrentSection(response.data.currentSection || 'patient-info');
      }
    } catch (error) {
      logger.error('Error fetching intake form:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSectionComplete = async (sectionId: string, sectionData: unknown) => {
    if (!intakeForm) return;

    setSavingSection(true);
    try {
      // Map section IDs to Firestore field names
      const sectionFieldMap: { [key: string]: string } = {
        'patient-info': 'patientInfo',
        'medical-history': 'medicalHistory',
        'family-history': 'familyHistory',
        'consent-form': 'consentForm',
      };

      const fieldName = sectionFieldMap[sectionId];
      if (!fieldName) {
        logger.error('Unknown section ID:', sectionId);
        return;
      }

      // Update the form with the completed section
      await intakeFormOperations.updateIntakeFormSection(intakeForm.id, fieldName, sectionData as Record<string, unknown>);

      // Wait a moment for Firestore to update, then refresh
      setTimeout(async () => {
        await fetchOrCreateIntakeForm();

        // Move to next section after data is refreshed
        const currentIndex = formSections.findIndex(s => s.id === sectionId);
        if (currentIndex < formSections.length - 1) {
          const nextSection = formSections[currentIndex + 1].id;
          setCurrentSection(nextSection);

          // Update the current section in Firestore
          await intakeFormOperations.updateIntakeFormCurrentSection(intakeForm.id, nextSection);
        } else {
          // All sections complete
          await completeIntakeForm();
        }
      }, 500);
    } catch (error) {
      logger.error('Error updating section:', error);
    } finally {
      setSavingSection(false);
    }
  };

  const handleSectionNavigation = async (sectionId: string) => {
    if (!canAccessSection(sectionId) || !intakeForm) return;

    setCurrentSection(sectionId);

    // Update current section in Firestore to preserve navigation state
    try {
      await intakeFormOperations.updateIntakeFormCurrentSection(intakeForm.id, sectionId);
    } catch (error) {
      logger.error('Error updating current section:', error);
    }
  };

  const completeIntakeForm = async () => {
    if (!intakeForm) return;

    try {
      await intakeFormOperations.completeIntakeForm(intakeForm.id);
      navigate('/dashboard');
    } catch (error) {
      logger.error('Error completing intake form:', error);
    }
  };

  const isSectionCompleted = (sectionId: string) => {
    const sectionFieldMap: { [key: string]: string } = {
      'patient-info': 'patientInfo',
      'medical-history': 'medicalHistory',
      'consent-form': 'consentForm',
    };
    const fieldName = sectionFieldMap[sectionId];
    return intakeForm?.completedSections?.includes(fieldName) || false;
  };

  const canAccessSection = (sectionId: string) => {
    const sectionIndex = formSections.findIndex(s => s.id === sectionId);
    if (sectionIndex === 0) return true; // First section always accessible

    const previousSection = formSections[sectionIndex - 1];
    return isSectionCompleted(previousSection.id);
  };

  const getOverallProgress = () => {
    // Count only sections that match our form sections
    const validSections = new Set(['patientInfo', 'medicalHistory', 'consentForm']);
    const completedCount = intakeForm?.completedSections?.filter(s => validSections.has(s)).length || 0;
    return Math.min(100, Math.round((completedCount / formSections.length) * 100));
  };

  if (userProfile?.role !== 'patient' && userProfile?.role !== 'admin') {
    return (
      <div className="text-center py-12">
        <FileText className="h-16 w-16 text-secondary-400 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-secondary-900 mb-2">Access Denied</h2>
        <p className="text-secondary-600">Patient intake forms are only available to patients and administrators.</p>
      </div>
    );
  }

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="space-y-6">

    {/* Header */}
    <Card className="p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-4 sm:space-y-0">
            <div className="flex items-center space-x-3 sm:space-x-4">
                <Link
                    to="/dashboard"
                    className="flex items-center text-primary-600 hover:text-primary-700 flex-shrink-0"
                >
                    <ArrowLeft className="h-5 w-5" />
                </Link>
                <div className="flex items-center space-x-3 min-w-0">
                    <div className="bg-primary-100 p-2 sm:p-3 rounded-lg flex-shrink-0">
                        <FileText className="h-6 w-6 sm:h-8 sm:w-8 text-primary-600" />
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-lg sm:text-xl font-bold text-secondary-900 truncate">Intake Forms</h1>
                        <p className="text-secondary-600 text-sm sm:text-base">
                            Complete your intake forms to get started
                        </p>
                    </div>
                </div>
            </div>
        </div>
    </Card>

      {/* Progress Overview */}
      <Card className="p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-2 sm:space-y-0 mb-4">
          <h2 className="text-lg font-semibold text-secondary-900">Overall Progress</h2>
          <span className="text-sm font-medium text-primary-600">
            {getOverallProgress()}% Complete
          </span>
        </div>
        <div className="w-full bg-secondary-200 rounded-full h-2 mb-6">
          <div
            className="bg-primary-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${getOverallProgress()}%` }}
          />
        </div>

        {/* Section Navigation */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {formSections.map((section) => {
            const IconComponent = section.icon;
            const isCompleted = isSectionCompleted(section.id);
            const isCurrent = currentSection === section.id;
            const canAccess = canAccessSection(section.id);

            return (
              <button
                key={section.id}
                onClick={() => canAccess && handleSectionNavigation(section.id)}
                disabled={!canAccess}
                className={`p-4 rounded-lg border-2 transition-all ${
                  isCurrent
                    ? 'border-primary-500 bg-primary-50'
                    : isCompleted
                    ? 'border-green-500 bg-green-50'
                    : canAccess
                    ? 'border-secondary-300 hover:border-secondary-400'
                    : 'border-secondary-200 opacity-50 cursor-not-allowed'
                }`}
              >
                <div className="flex items-center space-x-3 mb-2">
                  <div className={`p-2 rounded-lg ${
                    isCurrent
                      ? 'bg-primary-100'
                      : isCompleted
                      ? 'bg-green-100'
                      : 'bg-secondary-100'
                  }`}>
                    <IconComponent className={`h-5 w-5 ${
                      isCurrent
                        ? 'text-primary-600'
                        : isCompleted
                        ? 'text-green-600'
                        : 'text-secondary-600'
                    }`} />
                  </div>
                  {isCompleted ? (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  ) : (
                    <Circle className="h-5 w-5 text-secondary-400" />
                  )}
                </div>
                <h3 className="font-medium text-secondary-900 text-left">{section.title}</h3>
                <p className="text-sm text-secondary-600 text-left mt-1">{section.description}</p>
              </button>
            );
          })}
        </div>
      </Card>

      {/* Saving Indicator */}
      {savingSection && (
        <Card className="p-4 sm:p-6 mb-6">
          <div className="flex items-center space-x-3">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-600"></div>
            <p className="text-sm text-secondary-600">Saving your progress...</p>
          </div>
        </Card>
      )}

      {/* Current Section Form */}
      <div>
        {currentSection === 'patient-info' && (
          <PatientInfoSection
            onComplete={(data) => handleSectionComplete('patient-info', data)}
            initialData={intakeForm?.patientInfo}
          />
        )}

        {currentSection === 'medical-history' && (
          <MedicalHistorySection
            onComplete={(data: unknown) => handleSectionComplete('medical-history', data)}
            initialData={intakeForm?.medicalHistory}
          />
        )}

        {currentSection === 'family-history' && (
          <FamilyHistorySection
            onComplete={(data: unknown) => handleSectionComplete('family-history', data)}
            initialData={intakeForm?.familyHistory}
          />
        )}

        {currentSection === 'consent-form' && (
          <ConsentFormSection
            onComplete={(data: unknown) => handleSectionComplete('consent-form', data)}
            initialData={intakeForm?.consentForm}
          />
        )}

      </div>
    </div>
  );
};
