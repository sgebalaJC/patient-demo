import 'package:flutter/material.dart';
import '../config/branding.dart';
import '../config/colors.dart';

enum LegalDocument { terms, privacy }

/// Static Terms of Service / Privacy Policy screen.
///
/// Content mirrors `web/src/pages/LegalPage.tsx` — keep the two in sync
/// when the practice's legal team updates either document.
class LegalScreen extends StatelessWidget {
  final LegalDocument document;
  const LegalScreen({super.key, required this.document});

  String get _title => document == LegalDocument.privacy
      ? 'Privacy Policy'
      : 'Terms of Service';

  String get _content =>
      document == LegalDocument.privacy ? _privacyContent : _termsContent;

  String get _termsContent => '''
## Terms of Service

**Last updated: March 2026**

### 1. Acceptance of Terms
By accessing and using the ${branding.shortName} Patient App, you accept and agree to be bound by the terms and provision of this agreement.

### 2. Use License
Permission is granted to temporarily download one copy of the ${branding.shortName} Patient App for personal, non-commercial transitory viewing only. This is the grant of a license, not a transfer of title.

### 3. Medical Disclaimer
${branding.shortName} is a communication platform between patients and healthcare providers. It does not provide medical advice, diagnosis, or treatment. Always seek the advice of your physician or other qualified health provider with any questions you may have regarding a medical condition.

### 4. Account Responsibilities
You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account.

### 5. Privacy
Your use of ${branding.shortName} is also governed by our Privacy Policy. Please review our Privacy Policy to understand our practices.

### 6. Modifications
${branding.shortName} reserves the right to revise these terms of service at any time without notice. By using this application you are agreeing to be bound by the then current version of these terms of service.

### 7. Contact
If you have any questions about these Terms, please contact us at ${branding.supportEmail}.
''';

  String get _privacyContent => '''
## Privacy Policy

**Last updated: March 2026**

### 1. Information We Collect
We collect information you provide directly to us, such as when you create an account, schedule appointments, send messages, or submit prescription refill requests. This includes your name, email address, phone number, and health-related information.

### 2. How We Use Your Information
We use the information we collect to provide, maintain, and improve our services, including to facilitate communication between patients and healthcare providers, send appointment reminders, and process prescription refill requests.

### 3. Information Sharing
We do not sell, trade, or otherwise transfer your personally identifiable information to outside parties. This does not include trusted third parties who assist us in operating our application (such as SignalWire for SMS reminders), conducting our business, or servicing you, so long as those parties agree to keep this information confidential.

### 4. Data Security
We implement appropriate security measures to protect your personal information, including encryption of data in transit and at rest, role-based access controls, and regular security audits.

### 5. HIPAA Compliance
${branding.shortName} is designed to comply with the Health Insurance Portability and Accountability Act (HIPAA). We maintain appropriate administrative, physical, and technical safeguards to protect the privacy and security of your protected health information.

### 6. Your Rights
You have the right to access, correct, or delete your personal information. You may also request a copy of your data or ask us to restrict processing of your information.

### 7. Contact
If you have any questions about this Privacy Policy, please contact us at ${branding.supportEmail}.
''';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        foregroundColor: AppColors.textDark,
        title: Text(_title),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ..._renderLines(context),
              const SizedBox(height: 32),
              Center(
                child: Text(
                  '© ${DateTime.now().year} ${branding.appName}. All rights reserved.',
                  style: TextStyle(
                    fontSize: 12,
                    color: Colors.grey.shade500,
                  ),
                ),
              ),
              const SizedBox(height: 16),
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _renderLines(BuildContext context) {
    final lines = _content.split('\n');
    return lines.map<Widget?>((line) {
      if (line.startsWith('## ')) {
        return Padding(
          padding: const EdgeInsets.only(top: 8, bottom: 16),
          child: Text(
            line.substring(3),
            style: TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.bold,
              color: AppColors.textDark,
            ),
          ),
        );
      }
      if (line.startsWith('### ')) {
        return Padding(
          padding: const EdgeInsets.only(top: 20, bottom: 8),
          child: Text(
            line.substring(4),
            style: TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w600,
              color: AppColors.textDark,
            ),
          ),
        );
      }
      if (line.startsWith('**') && line.endsWith('**') && line.length > 4) {
        return Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Text(
            line.substring(2, line.length - 2),
            style: TextStyle(
              fontSize: 13,
              color: Colors.grey.shade500,
            ),
          ),
        );
      }
      if (line.trim().isEmpty) return null;
      return Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Text(
          line,
          style: TextStyle(
            fontSize: 15,
            height: 1.5,
            color: Colors.grey.shade800,
          ),
        ),
      );
    }).whereType<Widget>().toList();
  }
}
