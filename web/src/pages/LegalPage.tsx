import React from 'react';
import { useLocation, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { BRANDING } from '../config/branding';

const TERMS_CONTENT = `
## Terms of Service

**Last updated: March 2026**

### 1. Acceptance of Terms
By accessing and using the ${BRANDING.shortName} Patient App, you accept and agree to be bound by the terms and provision of this agreement.

### 2. Use License
Permission is granted to temporarily download one copy of the ${BRANDING.shortName} Patient App for personal, non-commercial transitory viewing only. This is the grant of a license, not a transfer of title.

### 3. Medical Disclaimer
${BRANDING.shortName} is a communication platform between patients and healthcare providers. It does not provide medical advice, diagnosis, or treatment. Always seek the advice of your physician or other qualified health provider with any questions you may have regarding a medical condition.

### 4. Account Responsibilities
You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account.

### 5. Privacy
Your use of ${BRANDING.shortName} is also governed by our Privacy Policy. Please review our Privacy Policy to understand our practices.

### 6. Modifications
${BRANDING.shortName} reserves the right to revise these terms of service at any time without notice. By using this application you are agreeing to be bound by the then current version of these terms of service.

### 7. Contact
If you have any questions about these Terms, please contact us at ${BRANDING.supportEmail}.
`;

const PRIVACY_CONTENT = `
## Privacy Policy

**Last updated: March 2026**

### 1. Information We Collect
We collect information you provide directly to us, such as when you create an account, schedule appointments, send messages, or submit prescription refill requests. This includes your name, email address, phone number, and health-related information.

### 2. How We Use Your Information
We use the information we collect to provide, maintain, and improve our services, including to facilitate communication between patients and healthcare providers, send appointment reminders, and process prescription refill requests.

### 3. Information Sharing
We do not sell, trade, or otherwise transfer your personally identifiable information to outside parties. This does not include trusted third parties who assist us in operating our application (such as Twilio for SMS reminders), conducting our business, or servicing you, so long as those parties agree to keep this information confidential.

### 4. Data Security
We implement appropriate security measures to protect your personal information, including encryption of data in transit and at rest, role-based access controls, and regular security audits.

### 5. HIPAA Compliance
${BRANDING.shortName} is designed to comply with the Health Insurance Portability and Accountability Act (HIPAA). We maintain appropriate administrative, physical, and technical safeguards to protect the privacy and security of your protected health information.

### 6. Your Rights
You have the right to access, correct, or delete your personal information. You may also request a copy of your data or ask us to restrict processing of your information.

### 7. Contact
If you have any questions about this Privacy Policy, please contact us at ${BRANDING.supportEmail}.
`;

export const LegalPage: React.FC = () => {
  const location = useLocation();
  const isPrivacy = location.pathname === '/privacy';
  const content = isPrivacy ? PRIVACY_CONTENT : TERMS_CONTENT;
  const title = isPrivacy ? 'Privacy Policy' : 'Terms of Service';

  return (
    <div className="min-h-screen bg-secondary-50">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <Link
          to="/"
          className="inline-flex items-center text-sm text-primary-600 hover:text-primary-700 mb-8"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to {BRANDING.shortName}
        </Link>

        <div className="bg-surface-card rounded-xl border border-secondary-200 p-8 sm:p-12">
          <h1 className="text-3xl font-bold text-secondary-900 mb-8">{title}</h1>
          <div className="prose prose-secondary max-w-none">
            {content.split('\n').map((line, i) => {
              if (line.startsWith('## ')) return <h2 key={i} className="text-2xl font-bold text-secondary-900 mt-8 mb-4">{line.replace('## ', '')}</h2>;
              if (line.startsWith('### ')) return <h3 key={i} className="text-lg font-semibold text-secondary-900 mt-6 mb-2">{line.replace('### ', '')}</h3>;
              if (line.startsWith('**') && line.endsWith('**')) return <p key={i} className="text-sm text-secondary-500 mb-4">{line.replace(/\*\*/g, '')}</p>;
              if (line.trim()) return <p key={i} className="text-secondary-700 mb-3 leading-relaxed">{line}</p>;
              return null;
            })}
          </div>
        </div>

        <div className="text-center mt-8 text-sm text-secondary-400">
          &copy; {new Date().getFullYear()} {BRANDING.appName}. All rights reserved.
        </div>
      </div>
    </div>
  );
};
