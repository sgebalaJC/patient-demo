import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { intakeFormOperations, userOperations } from '../lib/firestore';
import { PatientIntakeForm, PatientInfoForm, MedicalHistoryForm, ConsentForm, ConciergeAgreement } from '../types';
import {
  FileText,
  Check,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  User,
  AlertTriangle,
  Eye,
} from 'lucide-react';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { AccessDenied } from '../components/ui/AccessDenied';
import { PageHeader } from '../components/ui/PageHeader';
import { FilterTabs } from '../components/ui/FilterTabs';
import { EmptyState } from '../components/ui/EmptyState';
import { StatusBadge } from '../components/ui/StatusBadge';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { formatDate } from '../lib/date-helpers';
import logger from '../lib/logger';

const SECTION_LABELS: Record<string, string> = {
  patientInfo: 'Patient Information',
  medicalHistory: 'Medical History',
  consentForm: 'Consent Forms',
  conciergeAgreement: 'Concierge Agreement',
};

const BoolField: React.FC<{ label: string; value: boolean; warn?: boolean }> = ({ label, value, warn }) => (
  <div className="flex items-center justify-between py-1.5">
    <span className="text-sm text-secondary-600">{label}</span>
    <span className={`text-sm font-medium flex items-center gap-1 ${value ? (warn ? 'text-red-600' : 'text-green-600') : 'text-secondary-400'}`}>
      {value ? (warn ? <><AlertTriangle className="h-3.5 w-3.5" /> Yes</> : 'Yes') : 'No'}
    </span>
  </div>
);

const TextField: React.FC<{ label: string; value?: string }> = ({ label, value }) => {
  if (!value) return null;
  return (
    <div className="py-1.5">
      <span className="text-xs font-medium text-secondary-500 uppercase tracking-wide">{label}</span>
      <p className="text-sm text-secondary-800 mt-0.5">{value}</p>
    </div>
  );
};

const SectionCard: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
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
          <div key={i} className="py-2">
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

const FamilyHistorySectionView: React.FC<{ data: any }> = ({ data }) => (
  <div className="space-y-3">
    {data.conditions?.length > 0 && (
      <SectionCard title="Family Conditions">
        {data.conditions.map((entry: any, i: number) => (
          <div key={i} className="py-2">
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
              <span key={i} className="text-xs bg-secondary-100 text-secondary-700 px-2 py-1 rounded-full">{t}</span>
            ))}
          </div>
        </div>
        {data.communicationPreferences?.length > 0 && (
          <div className="py-1.5">
            <span className="text-xs font-medium text-secondary-500 uppercase tracking-wide">Communication</span>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {data.communicationPreferences.map((c, i) => (
                <span key={i} className="text-xs bg-secondary-100 text-secondary-700 px-2 py-1 rounded-full">{c}</span>
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

const FormDataViewer: React.FC<{ form: PatientIntakeForm }> = ({ form }) => {
  const [activeSection, setActiveSection] = useState<string | null>(null);

  const sections = [
    { key: 'patientInfo', label: 'Patient Information', data: form.patientInfo },
    { key: 'medicalHistory', label: 'Medical History', data: form.medicalHistory },
    { key: 'familyHistory', label: 'Family History', data: form.familyHistory },
    { key: 'consentForm', label: 'Consent Forms', data: form.consentForm },
    { key: 'conciergeAgreement', label: 'Concierge Agreement', data: form.conciergeAgreement },
  ].filter(s => s.data);

  if (sections.length === 0) {
    return <p className="text-sm text-secondary-400 italic">No form data submitted yet.</p>;
  }

  return (
    <div className="space-y-2">
      {/* Section tabs */}
      <div className="flex flex-wrap gap-1.5">
        {sections.map(s => (
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

      {/* Active section content */}
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

export const AdminIntakeFormsPage: React.FC = () => {
  const { user, userProfile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [forms, setForms] = useState<PatientIntakeForm[]>([]);
  const [patientNames, setPatientNames] = useState<Record<string, { firstName: string; lastName: string }>>({});
  const [filter, setFilter] = useState<'all' | 'completed' | 'in_progress' | 'approved'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [approveConfirmId, setApproveConfirmId] = useState<string | null>(null);
  const [sendBackId, setSendBackId] = useState<string | null>(null);
  const [sendBackNotes, setSendBackNotes] = useState('');

  useEffect(() => {
    if (user && userProfile?.role === 'admin') {
      loadForms();
    }
  }, [user, userProfile]);

  const loadForms = async () => {
    setLoading(true);
    try {
      const response = await intakeFormOperations.getAllSubmittedForms();
      if (response.success && response.data) {
        setForms(response.data);

        // Load patient names
        const ids = [...new Set(response.data.map(f => f.patientId))];
        if (ids.length > 0) {
          const namesMap: Record<string, { firstName: string; lastName: string }> = {};
          // Batch fetch users (10 at a time)
          for (let i = 0; i < ids.length; i += 10) {
            const batch = ids.slice(i, i + 10);
            for (const pid of batch) {
              const uRes = await userOperations.getUser(pid);
              if (uRes.success && uRes.data) {
                namesMap[pid] = {
                  firstName: uRes.data.firstName,
                  lastName: uRes.data.lastName,
                };
              }
            }
          }
          setPatientNames(namesMap);
        }
      }
    } catch (error) {
      logger.error('Error loading intake forms:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async (formId: string) => {
    if (!user) return;
    try {
      await intakeFormOperations.approveIntakeForm(formId, user.uid);
      loadForms();
    } catch (error) {
      logger.error('Error approving form:', error);
    }
    setApproveConfirmId(null);
  };

  const handleSendBack = async (formId: string) => {
    if (!user) return;
    try {
      await intakeFormOperations.sendBackIntakeForm(formId, user.uid, sendBackNotes || undefined);
      setSendBackNotes('');
      loadForms();
    } catch (error) {
      logger.error('Error sending back form:', error);
    }
    setSendBackId(null);
  };

  if (userProfile?.role !== 'admin') {
    return <AccessDenied />;
  }

  const filtered = filter === 'all' ? forms : forms.filter(f => f.status === filter);

  const statusCounts = {
    all: forms.length,
    completed: forms.filter(f => f.status === 'completed').length,
    in_progress: forms.filter(f => f.status === 'in_progress').length,
    approved: forms.filter(f => f.status === 'approved').length,
  };

  const getStatusColorClass = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-yellow-100 text-yellow-800';
      case 'approved': return 'bg-green-100 text-green-800';
      case 'in_progress': return 'bg-blue-100 text-blue-800';
      default: return 'bg-secondary-100 text-secondary-800';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'completed': return 'Submitted';
      case 'approved': return 'Accepted';
      case 'in_progress': return 'In Progress';
      case 'draft': return 'Draft';
      default: return status;
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        backTo="/admin"
        title="Intake Forms"
        subtitle="Review and approve patient intake forms"
        icon={FileText}
      />

      <FilterTabs
        tabs={[
          { key: 'all', label: 'All', count: statusCounts.all },
          { key: 'completed', label: 'Submitted', count: statusCounts.completed },
          { key: 'in_progress', label: 'In Progress', count: statusCounts.in_progress },
          { key: 'approved', label: 'Accepted', count: statusCounts.approved },
        ]}
        activeKey={filter}
        onChange={(f) => setFilter(f as typeof filter)}
      />

      {loading ? (
        <LoadingSpinner />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No intake forms"
          description={filter === 'all' ? 'No patients have started intake forms yet.' : `No forms with status "${getStatusLabel(filter)}".`}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((form) => {
            const name = patientNames[form.patientId];
            const patientName = name ? `${name.firstName} ${name.lastName}` : form.patientId;
            const isExpanded = expandedId === form.id;
            const sectionsComplete = form.completedSections?.length || 0;

            return (
              <div key={form.id} className="bg-surface-card border border-secondary-200 rounded-lg overflow-hidden">
                {/* Header row */}
                <div
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-secondary-50 transition-colors"
                  onClick={() => setExpandedId(isExpanded ? null : form.id)}
                >
                  <div className="flex items-center space-x-3 min-w-0">
                    <div className="p-2 bg-purple-100 rounded-lg flex-shrink-0">
                      <User className="h-4 w-4 text-purple-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-secondary-900 truncate">{patientName}</p>
                      <p className="text-xs text-secondary-500">
                        {sectionsComplete}/4 sections
                        {form.updatedAt && ` · Updated ${formatDate(form.updatedAt)}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3 flex-shrink-0">
                    <StatusBadge label={getStatusLabel(form.status)} colorClass={getStatusColorClass(form.status)} />
                    {isExpanded ? <ChevronUp className="h-4 w-4 text-secondary-400" /> : <ChevronDown className="h-4 w-4 text-secondary-400" />}
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-secondary-100">
                    {/* Sections checklist */}
                    <div className="grid grid-cols-2 gap-2 mt-3 mb-4">
                      {Object.entries(SECTION_LABELS).map(([key, label]) => {
                        const done = form.completedSections?.includes(key);
                        return (
                          <div key={key} className="flex items-center space-x-2">
                            <div className={`w-4 h-4 rounded-full flex items-center justify-center ${done ? 'bg-green-100' : 'bg-secondary-100'}`}>
                              {done && <Check className="h-3 w-3 text-green-600" />}
                            </div>
                            <span className={`text-sm ${done ? 'text-secondary-900' : 'text-secondary-400'}`}>{label}</span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Form data viewer */}
                    <div className="mb-4">
                      <FormDataViewer form={form} />
                    </div>

                    {/* Review notes */}
                    {form.reviewNotes && (
                      <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                        <p className="text-xs font-medium text-amber-800 mb-1">Review Notes</p>
                        <p className="text-sm text-amber-700">{form.reviewNotes}</p>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex space-x-2">
                      {form.status === 'completed' && (
                        <>
                          <button
                            onClick={() => setApproveConfirmId(form.id)}
                            className="flex items-center space-x-1.5 px-3 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
                          >
                            <Check className="h-3.5 w-3.5" />
                            <span>Accept</span>
                          </button>
                          <button
                            onClick={() => setSendBackId(form.id)}
                            className="flex items-center space-x-1.5 px-3 py-1.5 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-600 transition-colors"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            <span>Send Back</span>
                          </button>
                        </>
                      )}
                      {form.status === 'approved' && (
                        <span className="text-sm text-green-600 font-medium flex items-center space-x-1">
                          <Check className="h-4 w-4" />
                          <span>Accepted{form.approvedAt && ` on ${formatDate(form.approvedAt)}`}</span>
                        </span>
                      )}
                      {form.status === 'in_progress' && (
                        <span className="text-sm text-secondary-500">Patient is still working on this form</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Approve confirmation */}
      <ConfirmModal
        isOpen={!!approveConfirmId}
        title="Accept Intake Form"
        message="This will mark the patient's intake forms as accepted. Are you sure?"
        confirmLabel="Accept"
        variant="info"
        onConfirm={() => approveConfirmId && handleApprove(approveConfirmId)}
        onClose={() => setApproveConfirmId(null)}
      />

      {/* Send back modal */}
      {sendBackId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSendBackId(null)} />
          <div className="relative bg-surface-card rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-secondary-900 mb-2">Send Back for Corrections</h3>
            <p className="text-sm text-secondary-600 mb-4">
              The patient will be prompted to review and update their intake forms. Add a note about what needs to be corrected.
            </p>
            <textarea
              value={sendBackNotes}
              onChange={(e) => setSendBackNotes(e.target.value)}
              placeholder="What needs to be updated? (optional)"
              rows={3}
              className="w-full border border-secondary-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
            />
            <div className="flex justify-end space-x-2 mt-4">
              <button
                onClick={() => { setSendBackId(null); setSendBackNotes(''); }}
                className="px-4 py-2 text-sm text-secondary-600 hover:text-secondary-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleSendBack(sendBackId)}
                className="px-4 py-2 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-600 transition-colors"
              >
                Send Back
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
