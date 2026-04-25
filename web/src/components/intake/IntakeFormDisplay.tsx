/**
 * Read-only display components for the admin's intake-form review screen.
 * Pure presentation — every prop comes from a Firestore-loaded
 * `PatientIntakeForm` (or one of its sub-shapes). Lives here so
 * `AdminIntakeFormsPage` stays focused on list/filter/state and isn't 600+
 * lines of JSX.
 */

import React, { useState } from 'react';
import { AlertTriangle, Eye } from 'lucide-react';
import type {
  PatientIntakeForm,
  PatientInfoForm,
  MedicalHistoryForm,
  FamilyHistoryForm,
  ConsentForm,
  ConciergeAgreement,
} from '../../types';

export const BoolField: React.FC<{ label: string; value: boolean; warn?: boolean }> = ({ label, value, warn }) => (
  <div className="flex items-center justify-between py-1.5">
    <span className="text-sm text-secondary-600">{label}</span>
    <span className={`text-sm font-medium flex items-center gap-1 ${value ? (warn ? 'text-red-600' : 'text-green-600') : 'text-secondary-400'}`}>
      {value ? (warn ? <><AlertTriangle className="h-3.5 w-3.5" /> Yes</> : 'Yes') : 'No'}
    </span>
  </div>
);

export const TextField: React.FC<{ label: string; value?: string }> = ({ label, value }) => {
  if (!value) return null;
  return (
    <div className="py-1.5">
      <span className="text-xs font-medium text-secondary-500 uppercase tracking-wide">{label}</span>
      <p className="text-sm text-secondary-800 mt-0.5">{value}</p>
    </div>
  );
};

export const SectionCard: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="border border-secondary-200 rounded-lg overflow-hidden">
    <div className="bg-secondary-50 px-4 py-2">
      <h4 className="text-sm font-semibold text-secondary-700">{title}</h4>
    </div>
    <div className="px-4 py-3 divide-y divide-secondary-100">{children}</div>
  </div>
);

const PatientInfoSection: React.FC<{ data: PatientInfoForm }> = ({ data }) => (
  <div className="space-y-3">
    <SectionCard title="Personal Details">
      <TextField label="Full Name" value={data.fullName} />
      <TextField label="Date of Birth" value={data.dateOfBirth} />
      <TextField label="Phone Number" value={data.phoneNumber} />
      <TextField label="Gender" value={data.gender ? data.gender.charAt(0).toUpperCase() + data.gender.slice(1) : undefined} />
      <TextField label="Email" value={data.emailAddress} />
      <TextField label="Address" value={data.address} />
    </SectionCard>
    <SectionCard title="Emergency Contact">
      <TextField label="Name" value={data.emergencyContactName} />
      <TextField label="Relationship" value={data.emergencyContactRelationship} />
      <TextField label="Phone" value={data.emergencyContactPhone} />
    </SectionCard>
    {(data.insuranceProvider || data.policyNumber || data.groupNumber) && (
      <SectionCard title="Insurance Information">
        <TextField label="Provider" value={data.insuranceProvider} />
        <TextField label="Policy Number" value={data.policyNumber} />
        <TextField label="Group Number" value={data.groupNumber} />
      </SectionCard>
    )}
    {(data.pharmacyName || data.pharmacyPhone || data.pharmacyAddress) && (
      <SectionCard title="Preferred Pharmacy">
        <TextField label="Name" value={data.pharmacyName} />
        <TextField label="Phone" value={data.pharmacyPhone} />
        <TextField label="Address" value={data.pharmacyAddress} />
      </SectionCard>
    )}
  </div>
);

const MedicalHistorySectionView: React.FC<{ data: MedicalHistoryForm }> = ({ data }) => (
  <div className="space-y-3">
    {data.medicalHistory && (
      <SectionCard title="Medical History">
        <p className="text-sm text-secondary-800 py-1 whitespace-pre-line">{data.medicalHistory}</p>
      </SectionCard>
    )}
    {data.hospitalizations && (
      <SectionCard title="Hospitalizations">
        <p className="text-sm text-secondary-800 py-1 whitespace-pre-line">{data.hospitalizations}</p>
      </SectionCard>
    )}
    {data.pastSurgicalHistory && (
      <SectionCard title="Past Surgical History">
        <p className="text-sm text-secondary-800 py-1 whitespace-pre-line">{data.pastSurgicalHistory}</p>
      </SectionCard>
    )}
    {data.currentMedications && (
      <SectionCard title="Current Medications">
        <p className="text-sm text-secondary-800 py-1 whitespace-pre-line">{data.currentMedications}</p>
      </SectionCard>
    )}
    {data.allergies?.length > 0 && (
      <SectionCard title="Allergies">
        {data.allergies.map((a, i) => (
          <div key={`allergy-${i}-${a.allergen}`} className="py-2">
            <p className="text-sm font-medium text-secondary-900">{a.allergen}</p>
            <p className="text-xs text-secondary-500">Reaction: {a.reaction}</p>
          </div>
        ))}
      </SectionCard>
    )}
    <SectionCard title="Social History">
      <div className="py-1.5 flex items-center justify-between">
        <span className="text-sm text-secondary-600">Smoking</span>
        <span className="text-sm font-medium text-secondary-800 capitalize">
          {data.smokingStatus}{data.smokingDetails && ` — ${data.smokingDetails}`}
        </span>
      </div>
      <div className="py-1.5 flex items-center justify-between">
        <span className="text-sm text-secondary-600">Alcohol</span>
        <span className="text-sm font-medium text-secondary-800 capitalize">
          {data.alcoholConsumption}{data.alcoholDetails && ` — ${data.alcoholDetails}`}
        </span>
      </div>
      <div className="py-1.5 flex items-center justify-between">
        <span className="text-sm text-secondary-600">Exercise</span>
        <span className="text-sm font-medium text-secondary-800 capitalize">
          {data.exerciseFrequency}{data.exerciseDetails && ` — ${data.exerciseDetails}`}
        </span>
      </div>
    </SectionCard>
  </div>
);

const FamilyHistorySectionView: React.FC<{ data: FamilyHistoryForm }> = ({ data }) => (
  <div className="space-y-3">
    {data.conditions?.length > 0 && (
      <SectionCard title="Family Conditions">
        {data.conditions.map((entry, i) => (
          <div key={`family-${i}-${entry.condition}`} className="py-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-secondary-900">{entry.condition}</p>
              <span className="text-xs bg-secondary-100 text-secondary-600 px-2 py-0.5 rounded-full capitalize">
                {entry.relation}
              </span>
            </div>
            {entry.details && (
              <p className="text-xs text-secondary-500 mt-0.5">{entry.details}</p>
            )}
          </div>
        ))}
      </SectionCard>
    )}
    {data.otherHistory && (
      <SectionCard title="Other Family History">
        <p className="text-sm text-secondary-800 py-1 whitespace-pre-line">{data.otherHistory}</p>
      </SectionCard>
    )}
    {(!data.conditions || data.conditions.length === 0) && !data.otherHistory && (
      <p className="text-sm text-secondary-400 italic">No family history reported.</p>
    )}
  </div>
);

const ConsentSection: React.FC<{ data: ConsentForm }> = ({ data }) => (
  <div className="space-y-3">
    <SectionCard title="Consents">
      <BoolField label="Treatment consent" value={data.treatmentConsent} />
      <BoolField label="HIPAA consent" value={data.hipaaConsent} />
      <BoolField label="Financial responsibility" value={data.financialResponsibility} />
      <BoolField label="Communication consent" value={data.communicationConsent} />
      <BoolField label="Telemedicine consent" value={data.telemedConsent} />
      <BoolField label="Emergency consent" value={data.emergencyConsent} />
      <BoolField label="Photography consent" value={data.photographyConsent} />
      <BoolField label="Research participation" value={data.researchParticipation} />
      <BoolField label="Marketing communications" value={data.marketingCommunications} />
    </SectionCard>
    <SectionCard title="Signature">
      <TextField label="Patient signature" value={data.patientSignature} />
      <TextField label="Date signed" value={data.signatureDate} />
    </SectionCard>
  </div>
);

const ConciergeSection: React.FC<{ data: ConciergeAgreement }> = ({ data }) => (
  <div className="space-y-3">
    <SectionCard title="Membership">
      <div className="py-1.5 flex items-center justify-between">
        <span className="text-sm text-secondary-600">Plan</span>
        <span className="text-sm font-medium text-secondary-800 capitalize">{data.membershipPlan}</span>
      </div>
      <div className="py-1.5 flex items-center justify-between">
        <span className="text-sm text-secondary-600">Duration</span>
        <span className="text-sm font-medium text-secondary-800 capitalize">{data.membershipDuration}</span>
      </div>
    </SectionCard>
    <SectionCard title="Agreements">
      <BoolField label="Agreement acceptance" value={data.agreementAcceptance} />
      <BoolField label="Payment authorization" value={data.paymentAuthorization} />
      <BoolField label="Service agreement" value={data.serviceAgreement} />
      <BoolField label="Cancellation policy" value={data.cancellationPolicy} />
    </SectionCard>
    {data.preferredAppointmentTimes?.length > 0 && (
      <SectionCard title="Preferences">
        <div className="py-1.5">
          <span className="text-xs font-medium text-secondary-500 uppercase tracking-wide">Preferred times</span>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {data.preferredAppointmentTimes.map((t, i) => (
              <span key={`time-${i}-${t}`} className="text-xs bg-secondary-100 text-secondary-700 px-2 py-1 rounded-full">{t}</span>
            ))}
          </div>
        </div>
        {data.communicationPreferences?.length > 0 && (
          <div className="py-1.5">
            <span className="text-xs font-medium text-secondary-500 uppercase tracking-wide">Communication</span>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {data.communicationPreferences.map((c, i) => (
                <span key={`comm-${i}-${c}`} className="text-xs bg-secondary-100 text-secondary-700 px-2 py-1 rounded-full">{c}</span>
              ))}
            </div>
          </div>
        )}
        {data.specialRequests && <TextField label="Special requests" value={data.specialRequests} />}
      </SectionCard>
    )}
    {data.emergencyContact && (
      <SectionCard title="Emergency Contact">
        <div className="py-1.5">
          <p className="text-sm font-medium text-secondary-900">{data.emergencyContact.name} ({data.emergencyContact.relationship})</p>
          <p className="text-xs text-secondary-500">{data.emergencyContact.phoneNumber}</p>
        </div>
      </SectionCard>
    )}
    <SectionCard title="Signature">
      <TextField label="Patient signature" value={data.patientSignature} />
      <TextField label="Date signed" value={data.signatureDate} />
    </SectionCard>
  </div>
);

export const FormDataViewer: React.FC<{ form: PatientIntakeForm }> = ({ form }) => {
  const [activeSection, setActiveSection] = useState<string | null>(null);

  const sections = [
    { key: 'patientInfo', label: 'Patient Information', data: form.patientInfo },
    { key: 'medicalHistory', label: 'Medical History', data: form.medicalHistory },
    { key: 'familyHistory', label: 'Family History', data: form.familyHistory },
    { key: 'consentForm', label: 'Consent Forms', data: form.consentForm },
    { key: 'conciergeAgreement', label: 'Concierge Agreement', data: form.conciergeAgreement },
  ].filter((s) => s.data);

  if (sections.length === 0) {
    return <p className="text-sm text-secondary-400 italic">No form data submitted yet.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {sections.map((s) => (
          <button
            key={s.key}
            onClick={() => setActiveSection(activeSection === s.key ? null : s.key)}
            className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors flex items-center gap-1.5 ${
              activeSection === s.key
                ? 'bg-primary-100 text-primary-700 ring-1 ring-primary-300'
                : 'bg-secondary-100 text-secondary-600 hover:bg-secondary-200'
            }`}
          >
            <Eye className="h-3 w-3" />
            {s.label}
          </button>
        ))}
      </div>

      {activeSection && (
        <div className="mt-3 animate-in fade-in duration-200">
          {activeSection === 'patientInfo' && form.patientInfo && <PatientInfoSection data={form.patientInfo} />}
          {activeSection === 'medicalHistory' && form.medicalHistory && <MedicalHistorySectionView data={form.medicalHistory} />}
          {activeSection === 'familyHistory' && form.familyHistory && <FamilyHistorySectionView data={form.familyHistory} />}
          {activeSection === 'consentForm' && form.consentForm && <ConsentSection data={form.consentForm} />}
          {activeSection === 'conciergeAgreement' && form.conciergeAgreement && <ConciergeSection data={form.conciergeAgreement} />}
        </div>
      )}
    </div>
  );
};
