import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import '../config/colors.dart';
import '../config/branding.dart';

class TutorialStep {
  final String id;
  final String title;
  final String description;
  final IconData icon;
  final Color iconColor;
  final Color iconBg;
  /// Tab index for "Try It" — null for steps without a corresponding tab
  /// (welcome stays on home; intake/support open dedicated screens).
  final int? tabIndex;

  const TutorialStep({
    required this.id,
    required this.title,
    required this.description,
    required this.icon,
    required this.iconColor,
    required this.iconBg,
    this.tabIndex,
  });
}

final _steps = [
  TutorialStep(
    id: 'welcome',
    title: 'Welcome to ${branding.shortName}',
    description:
        'Your personal healthcare hub. Manage appointments, message your care team, request prescription refills, and more — all in one place.',
    icon: Icons.favorite_outline,
    iconColor: const Color(0xFF2563EB),
    iconBg: const Color(0xFFDBEAFE),
  ),
  const TutorialStep(
    id: 'appointments',
    title: 'Book Appointments',
    description:
        'View available time slots and schedule visits with your provider. You can also reschedule or cancel upcoming appointments.',
    icon: Icons.calendar_today_outlined,
    iconColor: Color(0xFF2563EB),
    iconBg: Color(0xFFDBEAFE),
    tabIndex: 1,
  ),
  const TutorialStep(
    id: 'messages',
    title: 'Message Your Care Team',
    description:
        'Send secure messages with file attachments to your provider. Get responses directly in the app — no phone tag needed.',
    icon: Icons.message_outlined,
    iconColor: Color(0xFF059669),
    iconBg: Color(0xFFD1FAE5),
    tabIndex: 2,
  ),
  const TutorialStep(
    id: 'refills',
    title: 'Request Prescription Refills',
    description:
        'Submit refill requests for your medications. Track the status of each request and get notified when they are ready.',
    icon: Icons.medication_outlined,
    iconColor: Color(0xFFEA580C),
    iconBg: Color(0xFFFFF7ED),
    tabIndex: 3,
  ),
  const TutorialStep(
    id: 'intake',
    title: 'Complete Intake Forms',
    description:
        'Fill out your patient info, medical history, and consent forms — all digitally, at your own pace.',
    icon: Icons.description_outlined,
    iconColor: Color(0xFF7C3AED),
    iconBg: Color(0xFFF3E8FF),
  ),
  TutorialStep(
    id: 'support',
    title: 'Meet ${branding.patientAgent.name}, Your AI Assistant',
    description:
        'Have questions about the practice, appointment hours, or how things work? ${branding.patientAgent.name} can help you find answers instantly.',
    icon: Icons.smart_toy_outlined,
    iconColor: const Color(0xFFD97706),
    iconBg: const Color(0xFFFEF3C7),
  ),
];

class OnboardingTutorial {
  /// Check if tutorial should be shown and display it.
  /// `onNavigateToTab` powers the "Try It" button — when omitted, that
  /// button is hidden and only Next/Skip are shown.
  static Future<void> showIfNeeded(
    BuildContext context,
    String uid, {
    void Function(int tabIndex)? onNavigateToTab,
  }) async {
    final doc =
        await FirebaseFirestore.instance.collection('users').doc(uid).get();
    final data = doc.data();
    if (data == null) return;

    if (data['role'] != 'patient') return;
    if (data['tutorialDismissedAt'] != null) return;

    final completed = List<String>.from(data['tutorialCompletedSections'] ?? []);
    final skipped = List<String>.from(data['tutorialSkippedSections'] ?? []);
    final allHandled = {...completed, ...skipped};

    final firstIncomplete = _steps.indexWhere((s) => !allHandled.contains(s.id));
    if (firstIncomplete == -1) {
      // All done, dismiss
      _dismiss(uid);
      return;
    }

    if (!context.mounted) return;

    showDialog(
      context: context,
      barrierDismissible: false,
      barrierColor: Colors.black54,
      builder: (_) => _TutorialDialog(
        uid: uid,
        initialStep: firstIncomplete,
        initialCompleted: completed,
        initialSkipped: skipped,
        onNavigateToTab: onNavigateToTab,
      ),
    );
  }

  static void _dismiss(String uid) {
    FirebaseFirestore.instance.collection('users').doc(uid).update({
      'tutorialDismissedAt': FieldValue.serverTimestamp(),
    }).catchError((_) {});
  }
}

class _TutorialDialog extends StatefulWidget {
  final String uid;
  final int initialStep;
  final List<String> initialCompleted;
  final List<String> initialSkipped;
  final void Function(int tabIndex)? onNavigateToTab;

  const _TutorialDialog({
    required this.uid,
    required this.initialStep,
    required this.initialCompleted,
    required this.initialSkipped,
    this.onNavigateToTab,
  });

  @override
  State<_TutorialDialog> createState() => _TutorialDialogState();
}

class _TutorialDialogState extends State<_TutorialDialog> {
  late final PageController _pageController;
  late int _currentStep;
  late List<String> _completed;
  late List<String> _skipped;

  @override
  void initState() {
    super.initState();
    _currentStep = widget.initialStep;
    _completed = List.from(widget.initialCompleted);
    _skipped = List.from(widget.initialSkipped);
    _pageController = PageController(initialPage: _currentStep);
  }

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  void _persist(Map<String, dynamic> updates) {
    FirebaseFirestore.instance
        .collection('users')
        .doc(widget.uid)
        .update(updates)
        .catchError((_) {});
  }

  void _completeStep() {
    final id = _steps[_currentStep].id;
    if (!_completed.contains(id)) {
      _completed.add(id);
      _persist({'tutorialCompletedSections': _completed});
    }
    _advance();
  }

  void _tryFeature() {
    final step = _steps[_currentStep];
    if (step.tabIndex == null || widget.onNavigateToTab == null) return;
    if (!_completed.contains(step.id)) {
      _completed.add(step.id);
      _persist({'tutorialCompletedSections': _completed});
    }
    Navigator.of(context).pop();
    widget.onNavigateToTab!(step.tabIndex!);
  }

  void _skipStep() {
    final id = _steps[_currentStep].id;
    if (!_skipped.contains(id)) {
      _skipped.add(id);
      _persist({'tutorialSkippedSections': _skipped});
    }
    _advance();
  }

  void _advance() {
    if (_currentStep < _steps.length - 1) {
      setState(() => _currentStep++);
      _pageController.animateToPage(
        _currentStep,
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeInOut,
      );
    } else {
      _dismiss();
    }
  }

  void _goBack() {
    if (_currentStep > 0) {
      setState(() => _currentStep--);
      _pageController.animateToPage(
        _currentStep,
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeInOut,
      );
    }
  }

  void _dismiss() {
    _persist({'tutorialDismissedAt': FieldValue.serverTimestamp()});
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final isFirst = _currentStep == 0;
    final isLast = _currentStep == _steps.length - 1;

    return Dialog(
      backgroundColor: AppColors.surfaceCard,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      insetPadding: const EdgeInsets.symmetric(horizontal: 24, vertical: 48),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Close button
          Align(
            alignment: Alignment.topRight,
            child: Padding(
              padding: const EdgeInsets.only(top: 8, right: 8),
              child: IconButton(
                onPressed: _dismiss,
                icon: Icon(Icons.close, color: Colors.grey.shade400, size: 22),
              ),
            ),
          ),

          // Page content
          SizedBox(
            height: 260,
            child: PageView.builder(
              controller: _pageController,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: _steps.length,
              itemBuilder: (_, i) => _buildStepContent(_steps[i]),
            ),
          ),

          // Step dots
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: List.generate(_steps.length, (i) {
              return AnimatedContainer(
                duration: const Duration(milliseconds: 200),
                margin: const EdgeInsets.symmetric(horizontal: 3),
                width: i == _currentStep ? 20 : 6,
                height: 6,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(3),
                  color: i == _currentStep
                      ? AppColors.primary
                      : i < _currentStep
                          ? AppColors.primary.withValues(alpha: 0.3)
                          : AppColors.divider,
                ),
              );
            }),
          ),

          const SizedBox(height: 20),

          // Actions
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                // Left: Back
                if (!isFirst)
                  TextButton.icon(
                    onPressed: _goBack,
                    icon: const Icon(Icons.chevron_left, size: 18),
                    label: const Text('Back'),
                    style: TextButton.styleFrom(
                      foregroundColor: AppColors.textMedium,
                    ),
                  )
                else
                  const SizedBox(width: 80),

                // Right: Skip + Next
                Row(
                  children: [
                    TextButton(
                      onPressed: _skipStep,
                      style: TextButton.styleFrom(
                        foregroundColor: AppColors.textMedium,
                      ),
                      child: const Text('Skip'),
                    ),
                    const SizedBox(width: 8),
                    ElevatedButton(
                      onPressed: () {
                        // Mid-tutorial steps with a tab target jump straight
                        // there ("Try It"), matching the web tutorial.
                        final step = _steps[_currentStep];
                        if (!isFirst &&
                            !isLast &&
                            step.tabIndex != null &&
                            widget.onNavigateToTab != null) {
                          _tryFeature();
                        } else {
                          _completeStep();
                        }
                      },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.primary,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(
                            horizontal: 20, vertical: 10),
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(10)),
                      ),
                      child: Text(
                        isFirst
                            ? 'Get Started'
                            : isLast
                                ? "Let's Go!"
                                : (_steps[_currentStep].tabIndex != null &&
                                        widget.onNavigateToTab != null
                                    ? 'Try It'
                                    : 'Next'),
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),

          // Step counter
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Text(
              '${_currentStep + 1} of ${_steps.length}',
              style: TextStyle(fontSize: 12, color: AppColors.textMedium),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStepContent(TutorialStep step) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 28),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          // Icon
          Container(
            width: 60,
            height: 60,
            decoration: BoxDecoration(
              color: step.iconBg,
              borderRadius: BorderRadius.circular(16),
            ),
            child: Icon(step.icon, size: 30, color: step.iconColor),
          ),
          const SizedBox(height: 20),
          // Title
          Text(
            step.title,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.bold,
              color: AppColors.textDark,
            ),
          ),
          const SizedBox(height: 10),
          // Description
          Text(
            step.description,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 14,
              height: 1.5,
              color: AppColors.textMedium,
            ),
          ),
        ],
      ),
    );
  }
}
