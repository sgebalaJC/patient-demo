import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { ConsentForm } from '../../types';
import { FileCheck, AlertTriangle, Shield, Eye } from 'lucide-react';
import { BRANDING } from '../../config/branding';

const isConcierge = BRANDING.practiceType === 'concierge';
const practiceLabel = isConcierge ? 'concierge medical practice' : 'medical practice';

const treatmentConsentText = `I voluntarily consent to the medical care and treatment to be rendered to me by the physicians and staff of this ${practiceLabel}. I understand that no guarantee has been made to me as to the result of treatments or examinations.

I understand that I have the right to be informed of the procedures to be performed, their risks, benefits, and alternatives. I acknowledge that I have been given the opportunity to ask questions about my treatment, and that all questions have been answered to my satisfaction.

I understand that the practice of medicine is not an exact science and that diagnosis and treatment may involve risks of injury or even death. I acknowledge that no warranty or guarantee has been made to me as to result or cure.`;

const financialResponsibilityText = `I acknowledge that I am financially responsible for all charges incurred for services provided to me or my dependents. I understand that payment is expected at the time services are provided unless other arrangements have been made.
${isConcierge ? `\nFor concierge members: I understand that my membership fee covers the services outlined in my membership agreement, but additional services may incur separate charges.\n` : ''}
I understand that I am responsible for any charges not covered by my insurance${isConcierge ? ' or membership plan' : ''}, including but not limited to:
- Services not covered by insurance
- Deductibles, co-payments, and co-insurance amounts
${isConcierge ? '- Services provided outside of my membership benefits\n' : ''}- Cancelled appointments without 24-hour notice

I authorize the practice to release any medical information necessary to process insurance claims and to assign benefits to the practice.`;

const emergencyConsentText = isConcierge
  ? `I understand that this concierge medical practice provides comprehensive primary care services but is not an emergency care facility. In case of a medical emergency, I should:

1. Call 911 immediately
2. Go to the nearest emergency department
3. Contact my concierge physician as soon as possible after emergency care

I understand that my concierge physician will coordinate with emergency care providers when possible and appropriate, but emergency care is outside the scope of the concierge membership.

I consent to the practice coordinating my care with emergency care providers, hospitals, and specialists as medically necessary.

I understand that emergency care costs are not included in my concierge membership fee and will be billed separately by the emergency care providers.`
  : `I understand that this medical practice provides primary care services but is not an emergency care facility. In case of a medical emergency, I should:

1. Call 911 immediately
2. Go to the nearest emergency department
3. Contact my physician as soon as possible after emergency care

I understand that my physician will coordinate with emergency care providers when possible and appropriate.

I consent to the practice coordinating my care with emergency care providers, hospitals, and specialists as medically necessary.

I understand that emergency care costs will be billed separately by the emergency care providers.`;

const marketingConsentText = `I consent to receive marketing communications from this practice, including:

- Health and wellness newsletters
- Information about new services and treatments
- Invitations to health education events
- Promotional materials about practice services
${isConcierge ? '- Updates about concierge membership benefits\n' : ''}
I understand that:
- This consent is separate from medical communications
- I can opt out of marketing communications at any time
- Opting out will not affect my medical care${isConcierge ? ' or membership benefits' : ''}
- My contact information will not be shared with third parties for marketing purposes

I can manage my communication preferences through the patient portal or by contacting the practice directly.`;

const consentFormSchema = z.object({
  treatmentConsent: z.boolean().refine(val => val === true, {
    message: 'You must consent to treatment to proceed'
  }),
  hipaaConsent: z.boolean().refine(val => val === true, {
    message: 'HIPAA consent is required'
  }),
  financialResponsibility: z.boolean().refine(val => val === true, {
    message: 'Financial responsibility acknowledgment is required'
  }),
  communicationConsent: z.boolean().refine(val => val === true, {
    message: 'Communication consent is required'
  }),
  telemedConsent: z.boolean().refine(val => val === true, {
    message: 'Telemedicine consent is required'
  }),
  emergencyConsent: z.boolean().refine(val => val === true, {
    message: 'Emergency care consent is required'
  }),
  photographyConsent: z.boolean(),
  researchParticipation: z.boolean(),
  marketingCommunications: z.boolean(),
  patientSignature: z.string().min(1, 'Digital signature is required'),
  signatureDate: z.string().min(1, 'Signature date is required'),
});

type ConsentFormFormData = z.infer<typeof consentFormSchema>;

interface ConsentFormSectionProps {
  onComplete: (data: ConsentForm) => void;
  initialData?: ConsentForm;
}

export const ConsentFormSection: React.FC<ConsentFormSectionProps> = ({
  onComplete,
  initialData,
}) => {
  const [loading, setLoading] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ConsentFormFormData>({
    resolver: zodResolver(consentFormSchema),
    defaultValues: initialData ? {
      ...initialData,
      signatureDate: initialData.signatureDate || new Date().toISOString().split('T')[0],
    } : {
      treatmentConsent: false,
      hipaaConsent: false,
      financialResponsibility: false,
      communicationConsent: false,
      telemedConsent: false,
      emergencyConsent: false,
      photographyConsent: false,
      researchParticipation: false,
      marketingCommunications: false,
      patientSignature: '',
      signatureDate: new Date().toISOString().split('T')[0],
    },
  });

  const onSubmit = async (data: ConsentFormFormData) => {
    setLoading(true);
    try {
      // completedAt is stamped server-side by updateIntakeFormSection.
      const formData = { ...data } as ConsentForm;
      onComplete(formData);
    } finally {
      setLoading(false);
    }
  };

  const ConsentSection = ({ 
    title, 
    content, 
    required = false, 
    fieldName, 
    icon: Icon 
  }: {
    title: string;
    content: string;
    required?: boolean;
    fieldName: keyof ConsentFormFormData;
    icon: any;
  }) => {
    const isExpanded = expandedSection === fieldName;
    const error = errors[fieldName]?.message;

    return (
      <div className="border border-secondary-200 rounded-lg">
        <div className="p-4">
          <div className="flex items-start space-x-3">
            <div className={`p-2 rounded-lg ${required ? 'bg-red-100' : 'bg-primary-100'}`}>
              <Icon className={`h-5 w-5 ${required ? 'text-red-600' : 'text-primary-600'}`} />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <h4 className="font-medium text-secondary-900 flex items-center">
                  {title}
                  {required && <span className="text-red-500 ml-1">*</span>}
                </h4>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setExpandedSection(isExpanded ? null : fieldName)}
                >
                  <Eye className="h-4 w-4 mr-2" />
                  {isExpanded ? 'Hide' : 'Read'} Details
                </Button>
              </div>

              {isExpanded && (
                <div className="mt-3 p-3 bg-secondary-50 rounded-lg text-sm text-secondary-700 whitespace-pre-line">
                  {content}
                </div>
              )}

              <div className="mt-3 flex items-start space-x-3">
                <input
                  {...register(fieldName)}
                  type="checkbox"
                  className="mt-1 h-4 w-4 text-primary-600 focus:ring-primary-500 border-secondary-300 rounded"
                />
                <label className="text-sm text-secondary-700">
                  I have read, understood, and agree to the {title.toLowerCase()}
                  {required && <span className="text-red-500 ml-1">*</span>}
                </label>
              </div>

              {error && (
                <p className="mt-2 text-sm text-red-600 flex items-center">
                  <AlertTriangle className="h-4 w-4 mr-1" />
                  {error}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <Card className="p-4 sm:p-8">
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center space-y-3 sm:space-y-0 sm:space-x-3 mb-4">
          <div className="bg-green-100 p-2 sm:p-3 rounded-lg flex-shrink-0">
            <FileCheck className="h-6 w-6 sm:h-8 sm:w-8 text-green-600" />
          </div>
          <div className="min-w-0">
            <h2 className="text-xl sm:text-2xl font-bold text-secondary-900 truncate">Consent for Treatment</h2>
            <p className="text-secondary-600 text-sm sm:text-base">
              Please review and consent to treatment policies and procedures
            </p>
          </div>
        </div>

        <div className="bg-primary-50 border border-primary-200 rounded-lg p-4">
          <div className="flex items-start space-x-3">
            <AlertTriangle className="h-5 w-5 text-primary-600 mt-0.5" />
            <div>
              <h3 className="font-medium text-primary-800">Important</h3>
              <p className="text-sm text-primary-700 mt-1">
                Please carefully read each section before providing consent. Required consents are marked with an asterisk (*).
              </p>
            </div>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <ConsentSection
          title="Treatment Consent"
          content={treatmentConsentText}
          required
          fieldName="treatmentConsent"
          icon={Shield}
        />

        <ConsentSection
          title="HIPAA Privacy Consent"
          content={`I acknowledge that I have been provided with a copy of the Notice of Privacy Practices that describes how my health information may be used or disclosed by this practice and my rights with respect to my health information.

I understand that this practice reserves the right to change the privacy practices that are described in the Notice and to make new provisions effective for all protected health information it maintains.

I understand that I may request restrictions on the use or disclosure of my health information but that the practice is not required to agree to those restrictions. However, if the practice agrees to a restriction I have requested, the practice must abide by that restriction.

I understand that I may revoke this consent in writing at any time except to the extent that action has already been taken in reliance on this consent.`}
          required
          fieldName="hipaaConsent"
          icon={Shield}
        />

        <ConsentSection
          title="Financial Responsibility"
          content={financialResponsibilityText}
          required
          fieldName="financialResponsibility"
          icon={FileCheck}
        />

        <ConsentSection
          title="Communication Consent"
          content={`I consent to receive communications from this practice via:
- Phone calls (including automated calls and text messages)
- Email communications
- Secure patient portal messages
- Postal mail

I understand that these communications may include:
- Appointment reminders and confirmations
- Test results and follow-up instructions
- Health education materials
- Practice announcements and updates

I understand that I may opt out of certain types of communications at any time by contacting the practice.

For text messages and emails, I understand that these communications may not be secure and there is a risk that my protected health information could be intercepted or accessed by unauthorized persons.`}
          required
          fieldName="communicationConsent"
          icon={Eye}
        />

        <ConsentSection
          title="Telemedicine Consent"
          content={`I understand and consent to the use of telemedicine in my care. Telemedicine involves the use of electronic communications to enable healthcare providers to deliver healthcare services remotely.

I understand the benefits of telemedicine, which may include:
- Convenient access to care
- Reduced travel time and costs
- Continuity of care during times when in-person visits are not possible

I understand the risks and limitations of telemedicine, which may include:
- Technical difficulties that may interrupt or delay treatment
- Information security risks
- Possibility that medical information transmitted may not be clear or complete
- Risk that the consultation may need to be terminated and rescheduled for an in-person visit

I understand that I have the right to discontinue telemedicine services at any time and that this will not affect my right to future care or treatment.`}
          required
          fieldName="telemedConsent"
          icon={Eye}
        />

        <ConsentSection
          title="Emergency Care Consent"
          content={emergencyConsentText}
          required
          fieldName="emergencyConsent"
          icon={AlertTriangle}
        />

        <ConsentSection
          title="Photography and Medical Imaging Consent"
          content={`I consent to the taking of photographs, videos, or digital images of me for medical documentation purposes. I understand that these images may be used for:

- Medical record documentation
- Treatment planning and follow-up
- Education of medical students and residents (with identifying information removed)
- Medical research (with identifying information removed)

I understand that my consent is voluntary and that I may withdraw this consent at any time. Images will be stored securely and in compliance with HIPAA regulations.

I understand that this consent does not apply to standard medical imaging (X-rays, CT scans, MRIs, etc.) which are considered part of routine medical care.`}
          required={false}
          fieldName="photographyConsent"
          icon={Eye}
        />

        <ConsentSection
          title="Research Participation"
          content={`I consent to the use of my de-identified health information for medical research purposes. This may include:

- Quality improvement studies
- Clinical research studies
- Population health research
- Medical education research

I understand that:
- My participation is voluntary
- My identity will be protected and information will be de-identified
- I may withdraw this consent at any time
- My decision will not affect my medical care
- I will not receive direct compensation for research participation
- Results of research may be published, but my identity will remain confidential

If specific research studies require my participation, I will be contacted separately and provided with detailed information about the study.`}
          required={false}
          fieldName="researchParticipation"
          icon={FileCheck}
        />

        <ConsentSection
          title="Marketing Communications"
          content={marketingConsentText}
          required={false}
          fieldName="marketingCommunications"
          icon={Eye}
        />

        {/* Digital Signature Section */}
        <div className="border-t border-secondary-200 pt-6">
          <h3 className="text-lg font-semibold text-secondary-900 mb-4">Digital Signature</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-secondary-700 mb-2">
                Type your full name as your digital signature *
              </label>
              <input
                {...register('patientSignature')}
                type="text"
                className="input w-full"
                placeholder="Your full legal name"
              />
              {errors.patientSignature && (
                <p className="mt-1 text-sm text-red-600">{errors.patientSignature.message}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-secondary-700 mb-2">
                Date *
              </label>
              <input
                {...register('signatureDate')}
                type="date"
                className="input w-full"
              />
              {errors.signatureDate && (
                <p className="mt-1 text-sm text-red-600">{errors.signatureDate.message}</p>
              )}
            </div>
          </div>
          <p className="mt-2 text-sm text-secondary-600">
            By typing your name and submitting this form, you are providing your electronic signature 
            and agreeing to all consents marked above.
          </p>
        </div>

        {/* Submit Button */}
        <div className="flex justify-end pt-6 border-t border-secondary-200">
          <Button type="submit" loading={loading} size="lg">
            Complete Consent Forms
          </Button>
        </div>
      </form>
    </Card>
  );
};
