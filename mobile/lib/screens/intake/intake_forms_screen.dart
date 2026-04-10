import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../config/colors.dart';
import '../../models/intake_form.dart';
import '../../providers/auth_provider.dart';
import '../../services/firestore/intake_forms_service.dart';
import '../../widgets/page_header.dart';
import 'patient_info_section.dart';
import 'medical_history_section.dart';
import 'consent_form_section.dart';

class IntakeFormsScreen extends StatefulWidget {
  final VoidCallback? onBack;
  const IntakeFormsScreen({super.key, this.onBack});

  @override
  State<IntakeFormsScreen> createState() => _IntakeFormsScreenState();
}

class _IntakeFormsScreenState extends State<IntakeFormsScreen> {
  final _service = IntakeFormsService();
  PatientIntakeForm? _form;
  bool _loading = true;
  bool _saving = false;
  String _currentSection = 'patient-info';

  static const _sections = [
    _SectionDef(
      id: 'patient-info',
      field: 'patientInfo',
      title: 'Patient Info',
      subtitle: 'Personal, emergency, and insurance details',
      icon: Icons.person_outline,
      color: Colors.blue,
    ),
    _SectionDef(
      id: 'medical-history',
      field: 'medicalHistory',
      title: 'Medical History',
      subtitle: 'Medical background',
      icon: Icons.favorite_outline,
      color: Colors.red,
    ),
    _SectionDef(
      id: 'consent-form',
      field: 'consentForm',
      title: 'Consent',
      subtitle: 'Treatment consents',
      icon: Icons.task_alt_outlined,
      color: Colors.green,
    ),
  ];

  @override
  void initState() {
    super.initState();
    _loadForm();
  }

  Future<void> _loadForm() async {
    final uid = context.read<AuthProvider>().firebaseUser?.uid;
    if (uid == null) return;

    setState(() => _loading = true);
    try {
      var form = await _service.getPatientIntakeForm(uid);
      if (form == null) {
        final id = await _service.createIntakeForm(uid);
        form = await _service.getPatientIntakeForm(uid);
        if (form == null) {
          // Fallback: construct a minimal form
          setState(() {
            _loading = false;
            _form = PatientIntakeForm(id: id, patientId: uid);
          });
          return;
        }
      }
      setState(() {
        _form = form;
        _currentSection = form!.currentSection;
      });
    } catch (_) {
      // silently handle
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  bool _isSectionCompleted(String sectionId) {
    final field = _sections.firstWhere((s) => s.id == sectionId).field;
    return _form?.completedSections.contains(field) ?? false;
  }

  bool _canAccessSection(String sectionId) {
    final idx = _sections.indexWhere((s) => s.id == sectionId);
    if (idx == 0) return true;
    return _isSectionCompleted(_sections[idx - 1].id);
  }

  static const _validSections = ['patientInfo', 'medicalHistory', 'consentForm'];
  int get _completedCount =>
      _form?.completedSections.where((s) => _validSections.contains(s)).length ?? 0;
  double get _progress => (_completedCount / _sections.length).clamp(0.0, 1.0);

  Future<void> _handleSectionComplete(
      String sectionId, Map<String, dynamic> data) async {
    if (_form == null) return;
    setState(() => _saving = true);

    try {
      final field =
          _sections.firstWhere((s) => s.id == sectionId).field;
      await _service.updateSection(_form!.id, field, data);

      final idx = _sections.indexWhere((s) => s.id == sectionId);
      if (idx < _sections.length - 1) {
        final next = _sections[idx + 1].id;
        await _service.updateCurrentSection(_form!.id, next);
        await _loadForm();
        setState(() => _currentSection = next);
      } else {
        // All sections done
        await _service.completeForm(_form!.id);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Intake forms completed!'),
              backgroundColor: AppColors.success,
            ),
          );
          Navigator.of(context).pop();
        }
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Failed to save. Please try again.'),
            backgroundColor: AppColors.error,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _navigateToSection(String sectionId) {
    if (!_canAccessSection(sectionId) || _form == null) return;
    setState(() => _currentSection = sectionId);
    _service.updateCurrentSection(_form!.id, sectionId);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: Column(
        children: [
          PageHeader(
            icon: Icons.description_outlined,
            title: 'Intake Forms',
            subtitle: 'Complete your intake forms',
            onBack: widget.onBack ?? () => Navigator.of(context).pop(),
          ),
          if (_loading)
            const Expanded(
              child: Center(child: CircularProgressIndicator()),
            )
          else
            Expanded(
              child: Column(
                children: [
                  // Progress bar + section pills
                  _buildProgressHeader(),
                  if (_saving)
                    Padding(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 16, vertical: 8),
                      child: Row(children: [
                        SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: AppColors.primary,
                          ),
                        ),
                        const SizedBox(width: 10),
                        Text('Saving...',
                            style: TextStyle(
                                fontSize: 13, color: AppColors.textMedium)),
                      ]),
                    ),
                  // Current section form
                  Expanded(child: _buildCurrentSection()),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildProgressHeader() {
    return Container(
      color: AppColors.surfaceCard,
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('Progress',
                  style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                      color: AppColors.textMedium)),
              Text('${(_progress * 100).round()}%',
                  style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: AppColors.primary)),
            ],
          ),
          const SizedBox(height: 6),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: _progress,
              backgroundColor: AppColors.divider,
              color: AppColors.primary,
              minHeight: 6,
            ),
          ),
          const SizedBox(height: 12),
          // Section pills
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: _sections.map((s) {
                final completed = _isSectionCompleted(s.id);
                final current = _currentSection == s.id;
                final canAccess = _canAccessSection(s.id);
                return Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: GestureDetector(
                    onTap: canAccess
                        ? () => _navigateToSection(s.id)
                        : null,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 8),
                      decoration: BoxDecoration(
                        color: current
                            ? AppColors.primary.withValues(alpha: 0.1)
                            : completed
                                ? AppColors.successBg
                                : AppColors.surfaceCard,
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(
                          color: current
                              ? AppColors.primary
                              : completed
                                  ? AppColors.success
                                  : canAccess
                                      ? AppColors.divider
                                      : AppColors.divider
                                          .withValues(alpha: 0.5),
                          width: current ? 1.5 : 1,
                        ),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            completed ? Icons.check_circle : s.icon,
                            size: 16,
                            color: current
                                ? AppColors.primary
                                : completed
                                    ? AppColors.success
                                    : canAccess
                                        ? AppColors.textMedium
                                        : AppColors.textMedium
                                            .withValues(alpha: 0.4),
                          ),
                          const SizedBox(width: 6),
                          Text(
                            s.title,
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: current
                                  ? FontWeight.w600
                                  : FontWeight.w500,
                              color: current
                                  ? AppColors.primary
                                  : completed
                                      ? AppColors.success
                                      : canAccess
                                          ? AppColors.textDark
                                          : AppColors.textMedium
                                              .withValues(alpha: 0.5),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                );
              }).toList(),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCurrentSection() {
    switch (_currentSection) {
      case 'patient-info':
        return PatientInfoSection(
          initialData: _form?.patientInfo,
          onComplete: (data) =>
              _handleSectionComplete('patient-info', data),
        );
      case 'medical-history':
        return MedicalHistorySection(
          initialData: _form?.medicalHistory,
          onComplete: (data) =>
              _handleSectionComplete('medical-history', data),
        );
      case 'consent-form':
        return ConsentFormSection(
          initialData: _form?.consentForm,
          onComplete: (data) =>
              _handleSectionComplete('consent-form', data),
        );
      default:
        return const Center(child: Text('Unknown section'));
    }
  }
}

class _SectionDef {
  final String id;
  final String field;
  final String title;
  final String subtitle;
  final IconData icon;
  final Color color;

  const _SectionDef({
    required this.id,
    required this.field,
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.color,
  });
}
