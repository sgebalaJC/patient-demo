import 'package:flutter/material.dart';
import '../../config/colors.dart';
import '../../models/intake_form.dart';

class ConsentFormSection extends StatefulWidget {
  final ConsentForm? initialData;
  final void Function(Map<String, dynamic> data) onComplete;

  const ConsentFormSection({
    super.key,
    this.initialData,
    required this.onComplete,
  });

  @override
  State<ConsentFormSection> createState() => _ConsentFormSectionState();
}

class _ConsentFormSectionState extends State<ConsentFormSection> {
  late bool _treatmentConsent;
  late bool _hipaaConsent;
  late bool _financialResponsibility;
  late bool _communicationConsent;
  late bool _telemedConsent;
  late bool _emergencyConsent;
  late bool _photographyConsent;
  late bool _researchParticipation;
  late bool _marketingCommunications;
  final _signatureCtrl = TextEditingController();
  String? _error;

  // Track which consent details are expanded
  final Set<String> _expanded = {};

  @override
  void initState() {
    super.initState();
    final d = widget.initialData;
    _treatmentConsent = d?.treatmentConsent ?? false;
    _hipaaConsent = d?.hipaaConsent ?? false;
    _financialResponsibility = d?.financialResponsibility ?? false;
    _communicationConsent = d?.communicationConsent ?? false;
    _telemedConsent = d?.telemedConsent ?? false;
    _emergencyConsent = d?.emergencyConsent ?? false;
    _photographyConsent = d?.photographyConsent ?? false;
    _researchParticipation = d?.researchParticipation ?? false;
    _marketingCommunications = d?.marketingCommunications ?? false;
    _signatureCtrl.text = d?.patientSignature ?? '';
  }

  @override
  void dispose() {
    _signatureCtrl.dispose();
    super.dispose();
  }

  void _submit() {
    // Validate required consents
    if (!_treatmentConsent ||
        !_hipaaConsent ||
        !_financialResponsibility ||
        !_communicationConsent ||
        !_telemedConsent ||
        !_emergencyConsent) {
      setState(() => _error = 'Please accept all required consents (marked with *)');
      return;
    }
    if (_signatureCtrl.text.trim().isEmpty) {
      setState(() => _error = 'Digital signature is required');
      return;
    }
    setState(() => _error = null);

    final data = ConsentForm(
      treatmentConsent: _treatmentConsent,
      hipaaConsent: _hipaaConsent,
      financialResponsibility: _financialResponsibility,
      communicationConsent: _communicationConsent,
      telemedConsent: _telemedConsent,
      emergencyConsent: _emergencyConsent,
      photographyConsent: _photographyConsent,
      researchParticipation: _researchParticipation,
      marketingCommunications: _marketingCommunications,
      patientSignature: _signatureCtrl.text.trim(),
      signatureDate: DateTime.now().toIso8601String().split('T')[0],
    ).toMap();
    widget.onComplete(data);
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Info banner
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.primary.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: AppColors.primary.withValues(alpha: 0.2)),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.info_outline, color: AppColors.primary, size: 20),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Please carefully read each section before providing consent. Required consents are marked with *.',
                    style: TextStyle(fontSize: 13, color: AppColors.textDark),
                  ),
                ),
              ],
            ),
          ),

          if (_error != null) ...[
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: AppColors.errorBg,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(children: [
                const Icon(Icons.error_outline, color: AppColors.error, size: 18),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(_error!,
                      style: const TextStyle(color: AppColors.error, fontSize: 13)),
                ),
              ]),
            ),
          ],

          const SizedBox(height: 16),

          _consentItem(
            'Treatment Consent',
            _treatmentConsentText,
            _treatmentConsent,
            (v) => setState(() => _treatmentConsent = v),
            required: true,
          ),
          _consentItem(
            'HIPAA Privacy Consent',
            _hipaaConsentText,
            _hipaaConsent,
            (v) => setState(() => _hipaaConsent = v),
            required: true,
          ),
          _consentItem(
            'Financial Responsibility',
            _financialText,
            _financialResponsibility,
            (v) => setState(() => _financialResponsibility = v),
            required: true,
          ),
          _consentItem(
            'Communication Consent',
            _communicationText,
            _communicationConsent,
            (v) => setState(() => _communicationConsent = v),
            required: true,
          ),
          _consentItem(
            'Telemedicine Consent',
            _telemedText,
            _telemedConsent,
            (v) => setState(() => _telemedConsent = v),
            required: true,
          ),
          _consentItem(
            'Emergency Care Consent',
            _emergencyText,
            _emergencyConsent,
            (v) => setState(() => _emergencyConsent = v),
            required: true,
          ),
          _consentItem(
            'Photography Consent',
            _photographyText,
            _photographyConsent,
            (v) => setState(() => _photographyConsent = v),
          ),
          _consentItem(
            'Research Participation',
            _researchText,
            _researchParticipation,
            (v) => setState(() => _researchParticipation = v),
          ),
          _consentItem(
            'Marketing Communications',
            _marketingText,
            _marketingCommunications,
            (v) => setState(() => _marketingCommunications = v),
          ),

          const SizedBox(height: 20),
          Divider(color: AppColors.divider),
          const SizedBox(height: 16),

          Text('Digital Signature',
              style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textDark)),
          const SizedBox(height: 8),
          TextField(
            controller: _signatureCtrl,
            decoration: InputDecoration(
              labelText: 'Type your full legal name *',
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'By typing your name and submitting, you are providing your electronic signature and agreeing to all consents marked above.',
            style: TextStyle(fontSize: 12, color: Colors.grey.shade600),
          ),

          const SizedBox(height: 24),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: _submit,
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primary,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10)),
              ),
              child: const Text('Complete Consent Forms',
                  style: TextStyle(fontWeight: FontWeight.w600)),
            ),
          ),
          const SizedBox(height: 16),
        ],
      ),
    );
  }

  Widget _consentItem(
    String title,
    String content,
    bool value,
    ValueChanged<bool> onChanged, {
    bool required = false,
  }) {
    final isExpanded = _expanded.contains(title);
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      decoration: BoxDecoration(
        color: AppColors.surfaceCard,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.divider),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    '$title${required ? ' *' : ''}',
                    style: TextStyle(
                      fontWeight: FontWeight.w600,
                      fontSize: 14,
                      color: AppColors.textDark,
                    ),
                  ),
                ),
                GestureDetector(
                  onTap: () => setState(() {
                    if (isExpanded) {
                      _expanded.remove(title);
                    } else {
                      _expanded.add(title);
                    }
                  }),
                  child: Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: AppColors.primary.withValues(alpha: 0.08),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      isExpanded ? 'Hide' : 'Read',
                      style: TextStyle(
                          fontSize: 12,
                          color: AppColors.primary,
                          fontWeight: FontWeight.w500),
                    ),
                  ),
                ),
              ],
            ),
          ),
          if (isExpanded)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
              child: Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: AppColors.background,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(content,
                    style: TextStyle(fontSize: 12, color: AppColors.textMedium)),
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(4, 4, 12, 8),
            child: Row(
              children: [
                Checkbox(
                  value: value,
                  onChanged: (v) => onChanged(v ?? false),
                  activeColor: AppColors.primary,
                ),
                Expanded(
                  child: GestureDetector(
                    onTap: () => onChanged(!value),
                    child: Text(
                      'I have read, understood, and agree to the ${title.toLowerCase()}',
                      style: TextStyle(fontSize: 13, color: AppColors.textDark),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// Consent text content
const _treatmentConsentText =
    'I voluntarily consent to the medical care and treatment to be rendered to me by the physicians and staff of this concierge medical practice. I understand that no guarantee has been made to me as to the result of treatments or examinations.\n\nI understand that I have the right to be informed of the procedures to be performed, their risks, benefits, and alternatives. I acknowledge that I have been given the opportunity to ask questions about my treatment.';

const _hipaaConsentText =
    'I acknowledge that I have been provided with a copy of the Notice of Privacy Practices that describes how my health information may be used or disclosed by this practice and my rights with respect to my health information.\n\nI understand that I may request restrictions on the use or disclosure of my health information. I understand that I may revoke this consent in writing at any time.';

const _financialText =
    'I acknowledge that I am financially responsible for all charges incurred for services provided to me or my dependents. Payment is expected at the time services are provided unless other arrangements have been made.\n\nI am responsible for charges not covered by insurance or membership, including deductibles, co-payments, and cancelled appointments without 24-hour notice.';

const _communicationText =
    'I consent to receive communications from this practice via phone calls, text messages, email, secure patient portal messages, and postal mail. These may include appointment reminders, test results, health education materials, and practice updates.\n\nI may opt out of certain communications at any time by contacting the practice.';

const _telemedText =
    'I understand and consent to the use of telemedicine in my care. Benefits may include convenient access and reduced travel. Risks include technical difficulties and information security concerns.\n\nI may discontinue telemedicine services at any time without affecting my right to future care.';

const _emergencyText =
    'I understand this practice provides primary care, not emergency care. In a medical emergency, I should call 911 immediately and go to the nearest emergency department.\n\nEmergency care costs are not included in my concierge membership fee.';

const _photographyText =
    'I consent to photographs, videos, or digital images for medical documentation, treatment planning, and education (with identifying information removed).\n\nThis consent is voluntary and may be withdrawn at any time.';

const _researchText =
    'I consent to the use of my de-identified health information for quality improvement, clinical research, and medical education. My identity will be protected and I may withdraw consent at any time.';

const _marketingText =
    'I consent to receive health newsletters, information about new services, event invitations, and promotional materials. I can opt out at any time without affecting my care.';
