import React from 'react';
import {createPortal} from 'react-dom';
import {X, FileText} from 'lucide-react';
import {Button} from './Button';
import {BRANDING} from '../../config/branding';

interface LegalModalProps {
    isOpen: boolean;
    onClose: () => void;
    type: 'terms' | 'privacy';
}

export const LegalModal: React.FC<LegalModalProps> = ({isOpen, onClose, type}) => {
    if (!isOpen) return null;

    const content = {
        terms: {
            title: 'Terms of Service',
            sections: [
                {
                    title: '1. Acceptance of Terms',
                    content: `By accessing and using the ${BRANDING.shortName} Patient App, you accept and agree to be bound by the terms and provision of this agreement.`
                },
                {
                    title: '2. Use License',
                    content: `Permission is granted to temporarily download one copy of the ${BRANDING.shortName} Patient App for personal, non-commercial transitory viewing only. This is the grant of a license, not a transfer of title.`
                },
                {
                    title: '3. Medical Information',
                    content: 'The information provided through this app is for informational purposes only and should not be considered as medical advice. Always consult with your healthcare provider for medical decisions.'
                },
                {
                    title: '4. User Responsibilities',
                    content: 'You are responsible for maintaining the confidentiality of your account information and for all activities that occur under your account.'
                },
                {
                    title: '5. Privacy and Data Protection',
                    content: 'We are committed to protecting your privacy and handling your personal health information in accordance with applicable laws and regulations.'
                },
                {
                    title: '6. Limitation of Liability',
                    content: `In no event shall ${BRANDING.legalEntity} or its suppliers be liable for any damages arising out of the use or inability to use the materials on this app.`
                }
            ]
        },
        privacy: {
            title: 'Privacy Policy',
            sections: [
                {
                    title: '1. Information We Collect',
                    content: 'We collect information you provide directly to us, such as when you create an account, update your profile, or communicate with healthcare providers through our platform.'
                },
                {
                    title: '2. How We Use Your Information',
                    content: 'We use the information we collect to provide, maintain, and improve our services, facilitate communication between you and your healthcare providers, and ensure the security of our platform.'
                },
                {
                    title: '3. Information Sharing',
                    content: 'We do not sell, trade, or otherwise transfer your personal information to third parties without your consent, except as described in this privacy policy or as required by law.'
                },
                {
                    title: '4. Data Security',
                    content: 'We implement appropriate security measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction.'
                },
                {
                    title: '5. HIPAA Compliance',
                    content: 'We comply with the Health Insurance Portability and Accountability Act (HIPAA) and maintain appropriate safeguards for your protected health information.'
                },
                {
                    title: '6. Your Rights',
                    content: 'You have the right to access, update, or delete your personal information. You may also request restrictions on the use of your information.'
                },
                {
                    title: '7. Contact Us',
                    content: `If you have any questions about this Privacy Policy, please contact us at ${BRANDING.supportEmail} or through our support channels.`
                }
            ]
        }
    };

    const currentContent = content[type];

    return createPortal(
        <div>
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                <div className="bg-surface-card rounded-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
                    <div
                        className="flex items-center justify-between p-6 border-b border-secondary-200 sticky top-0 bg-surface-card">
                        <div className="flex items-center space-x-3">
                            <div className="bg-primary-100 p-2 rounded-lg">
                                <FileText className="h-6 w-6 text-primary-600"/>
                            </div>
                            <h2 className="text-xl font-semibold text-secondary-900">
                                {currentContent.title}
                            </h2>
                        </div>
                        <button
                            onClick={onClose}
                            className="text-secondary-400 hover:text-secondary-600"
                        >
                            <X className="h-6 w-6"/>
                        </button>
                    </div>

                    <div className="p-6">
                        <div className="prose max-w-none">
                            <p className="text-secondary-600 mb-6">
                                Last updated: {new Date().toLocaleDateString()}
                            </p>

                            <div className="space-y-6">
                                {currentContent.sections.map((section, index) => (
                                    <div key={index}>
                                        <h3 className="text-lg font-semibold text-secondary-900 mb-3">
                                            {section.title}
                                        </h3>
                                        <p className="text-secondary-700 leading-relaxed">
                                            {section.content}
                                        </p>
                                    </div>
                                ))}
                            </div>

                            {type === 'terms' && (
                                <div className="mt-8 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                                    <p className="text-sm text-yellow-800">
                                        <strong>Important:</strong> These terms may be updated from time to time.
                                        Continued use of the service constitutes acceptance of any changes.
                                    </p>
                                </div>
                            )}

                            {type === 'privacy' && (
                                <div className="mt-8 p-4 bg-primary-50 border border-primary-200 rounded-lg">
                                    <p className="text-sm text-primary-800">
                                        <strong>Note:</strong> This privacy policy complies with HIPAA regulations
                                        and other applicable privacy laws to ensure your health information is
                                        protected.
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="flex justify-end p-6 border-t border-secondary-200">
                        <Button onClick={onClose} variant="primary">
                            Close
                        </Button>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
};
