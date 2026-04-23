import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../services/firestore/appointments_service.dart';
import '../services/firestore/messages_service.dart';
import '../services/firestore/notifications_service.dart';
import '../models/appointment.dart';
import '../models/message_thread.dart';
import '../models/notification.dart';
import '../widgets/phone_verification_sheet.dart';
import '../widgets/skeleton.dart';
import '../widgets/status_chip.dart';
import '../config/colors.dart';
import '../config/branding.dart';
import '../providers/theme_provider.dart';
import '../utils/date_formatting.dart';
import 'package:firebase_auth/firebase_auth.dart' show FirebaseAuth;
import 'notifications/notifications_screen.dart';
import 'support/support_chat_screen.dart';
import '../widgets/onboarding_tutorial.dart';
import '../services/firestore/intake_forms_service.dart';
import '../models/intake_form.dart';
import 'intake/intake_forms_screen.dart';
import 'contact_screen.dart';

class DashboardScreen extends StatefulWidget {
  final void Function(int index)? onNavigate;

  const DashboardScreen({super.key, this.onNavigate});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  final _appointmentsService = AppointmentsService();
  final _messagesService = MessagesService();
  final _notificationsService = NotificationsService();
  final _intakeService = IntakeFormsService();

  List<Appointment> _upcomingAppointments = [];
  List<MessageThread> _recentThreads = [];
  bool _loading = true;
  bool _showIntakeBanner = false;
  bool _intakeSentBack = false;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    final auth = context.read<AuthProvider>();
    final patientId = auth.firebaseUser?.uid;
    if (patientId == null) return;

    try {
      final appointments =
          await _appointmentsService.getUpcomingAppointments(patientId);
      final threads =
          await _messagesService.getPatientThreads(patientId, limit: 3);

      // Check intake form status
      bool showIntake = false;
      bool sentBack = false;
      final user = auth.userProfile;
      if (user != null && user.isPatient && !user.intakeFormSkipped) {
        final form = await _intakeService.getPatientIntakeForm(patientId);
        if (form == null) {
          showIntake = true;
        } else if (form.status == IntakeFormStatus.draft ||
            form.status == IntakeFormStatus.inProgress) {
          showIntake = true;
          if (form.completedAt != null) sentBack = true; // was completed then sent back
        }
      }

      if (mounted) {
        setState(() {
          _upcomingAppointments = appointments;
          _recentThreads = threads;
          _showIntakeBanner = showIntake;
          _intakeSentBack = sentBack;
          _loading = false;
        });
        // Show onboarding tutorial for new patients
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) {
            OnboardingTutorial.showIfNeeded(context, patientId);
          }
        });
      }
    } catch (e) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final user = auth.userProfile;

    final themeProvider = context.watch<ThemeProvider>();
    final logoAsset = themeProvider.currentId == AppThemeId.dark
        ? branding.logos.fullDark
        : branding.logos.full;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.surfaceCard,
        elevation: 0,
        scrolledUnderElevation: 1,
        titleSpacing: 16,
        title: Image.asset(
          logoAsset,
          height: 38,
          fit: BoxFit.contain,
        ),
        actions: [
          // Support chat
          IconButton(
            icon: Icon(Icons.smart_toy_outlined,
                color: AppColors.textDark),
            onPressed: () {
              Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (_) => const SupportChatScreen(),
                ),
              );
            },
          ),
          // Notification bell
          StreamBuilder<List<AppNotification>>(
            stream: auth.firebaseUser != null
                ? _notificationsService
                    .patientNotificationsStream(auth.firebaseUser!.uid)
                : const Stream.empty(),
            builder: (context, snapshot) {
              final unreadCount = snapshot.data
                      ?.where((n) =>
                          !n.isReadByUser(auth.firebaseUser?.uid ?? ''))
                      .length ??
                  0;
              return Stack(
                children: [
                  IconButton(
                    icon: Icon(Icons.notifications_outlined,
                        color: AppColors.textDark),
                    onPressed: () {
                      Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => NotificationsScreen(
                            onNavigate: widget.onNavigate,
                          ),
                        ),
                      );
                    },
                  ),
                  if (unreadCount > 0)
                    Positioned(
                      right: 8,
                      top: 8,
                      child: Container(
                        padding: const EdgeInsets.all(4),
                        decoration: const BoxDecoration(
                          color: Colors.red,
                          shape: BoxShape.circle,
                        ),
                        constraints: const BoxConstraints(
                            minWidth: 18, minHeight: 18),
                        child: Text(
                          unreadCount > 9 ? '9+' : '$unreadCount',
                          style: TextStyle(
                            color: AppColors.surfaceCard,
                            fontSize: 10,
                            fontWeight: FontWeight.bold,
                          ),
                          textAlign: TextAlign.center,
                        ),
                      ),
                    ),
                ],
              );
            },
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _loadData,
        child: _loading
            ? _buildSkeleton()
            : ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  // Email verification banner
                  if (FirebaseAuth.instance.currentUser != null &&
                      !FirebaseAuth.instance.currentUser!.emailVerified)
                    _buildEmailVerificationBanner(),

                  // Phone verification banner (non-blocking)
                  if (user != null &&
                      user.phoneNumber != null &&
                      user.phoneNumber!.isNotEmpty &&
                      user.phoneVerified != true)
                    _buildVerifyPhoneBanner(context, user.phoneNumber!),

                  // Intake forms banner
                  if (_showIntakeBanner)
                    _buildIntakeFormBanner(),

                  // Upcoming appointments
                  _buildSectionHeader('Upcoming Appointments',
                      onSeeAll: () {
                    widget.onNavigate?.call(1);
                  }),
                  const SizedBox(height: 8),
                  if (_upcomingAppointments.isEmpty)
                    _buildEmptyCard('No upcoming appointments')
                  else
                    ..._upcomingAppointments
                        .take(3)
                        .map(_buildAppointmentCard),
                  const SizedBox(height: 24),

                  // Recent messages
                  _buildSectionHeader('Recent Messages', onSeeAll: () {
                    widget.onNavigate?.call(2);
                  }),
                  const SizedBox(height: 8),
                  if (_recentThreads.isEmpty)
                    _buildEmptyCard('No messages yet')
                  else
                    ..._recentThreads.map(_buildMessageCard),
                  const SizedBox(height: 24),

                  // Contact us
                  _buildContactCard(),
                  const SizedBox(height: 16),
                ],
              ),
      ),
    );
  }


  Widget _buildSkeleton() {
    return ListView(
      padding: const EdgeInsets.all(16),
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        // Appointments section
        const Skeleton(height: 18, width: 180),
        const SizedBox(height: 12),
        const SkeletonList(rows: 2),
        const SizedBox(height: 24),
        // Messages section
        const Skeleton(height: 18, width: 160),
        const SizedBox(height: 12),
        const SkeletonList(rows: 2, showLeading: false),
        const SizedBox(height: 24),
        // Contact card
        const SkeletonList(rows: 1),
      ],
    );
  }

  Widget _buildSectionHeader(String title, {VoidCallback? onSeeAll}) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          title,
          style: TextStyle(
            fontSize: 17,
            fontWeight: FontWeight.w600,
            color: AppColors.textDark,
          ),
        ),
        if (onSeeAll != null)
          TextButton(
            onPressed: onSeeAll,
            child: const Text('See All'),
          ),
      ],
    );
  }

  Widget _buildEmailVerificationBanner() {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.amber.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.amber.withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.mail_outlined, color: Colors.amber.shade700, size: 20),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Please verify your email address.',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: Colors.amber.shade800,
                  ),
                ),
              ),
              TextButton(
                onPressed: () async {
                  await FirebaseAuth.instance.currentUser?.sendEmailVerification();
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Verification email sent! Check your inbox.')),
                    );
                  }
                },
                style: TextButton.styleFrom(
                  foregroundColor: Colors.amber.shade800,
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                ),
                child: const Text('Resend', style: TextStyle(fontWeight: FontWeight.w600)),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            'Check your spam or junk folder — emails from ${branding.fromEmail} sometimes end up there.',
            style: TextStyle(fontSize: 12, color: Colors.amber.shade700),
          ),
        ],
      ),
    );
  }

  Widget _buildVerifyPhoneBanner(BuildContext context, String phoneNumber) {
    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.primary.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.primary.withValues(alpha: 0.2)),
      ),
      child: Row(
        children: [
          Icon(Icons.verified_user_outlined,
              color: AppColors.primary, size: 20),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              'Verify your phone number to receive appointment reminders via SMS.',
              style: TextStyle(
                fontSize: 13,
                color: AppColors.primary,
              ),
            ),
          ),
          const SizedBox(width: 8),
          TextButton(
            onPressed: () {
              PhoneVerificationSheet.show(
                context: context,
                phoneNumber: phoneNumber,
                onVerified: (_) {},
              );
            },
            style: TextButton.styleFrom(
              foregroundColor: AppColors.primary,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            ),
            child: const Text(
              'Verify',
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildIntakeFormBanner() {
    final color = _intakeSentBack ? Colors.amber : AppColors.purple;
    final borderColor = _intakeSentBack ? Colors.amber.shade200 : AppColors.purple.withValues(alpha: 0.4);

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      decoration: BoxDecoration(
        color: AppColors.surfaceCard,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: borderColor),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () {
          Navigator.push(context,
            MaterialPageRoute(builder: (_) => const IntakeFormsScreen()),
          ).then((_) => _loadData());
        },
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(Icons.description_outlined, size: 20, color: color),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _intakeSentBack
                          ? 'Your intake forms need attention'
                          : 'Complete your intake forms',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textDark,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      _intakeSentBack
                          ? 'Your provider requested updates'
                          : 'MRI screening, medical history, consents',
                      style: TextStyle(fontSize: 12, color: AppColors.textMedium),
                    ),
                  ],
                ),
              ),
              if (!_intakeSentBack)
                GestureDetector(
                  onTap: () {
                    final uid = context.read<AuthProvider>().firebaseUser?.uid;
                    if (uid != null) {
                      FirebaseFirestore.instance
                          .collection('users')
                          .doc(uid)
                          .update({'intakeFormSkipped': true})
                          .catchError((_) {});
                    }
                    setState(() => _showIntakeBanner = false);
                  },
                  child: Padding(
                    padding: const EdgeInsets.all(4),
                    child: Icon(Icons.close, size: 18, color: Colors.grey.shade400),
                  ),
                )
              else
                Icon(Icons.chevron_right, size: 20, color: color),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildContactCard() {
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: () {
        Navigator.push(
          context,
          MaterialPageRoute(builder: (_) => const ContactScreen()),
        );
      },
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppColors.surfaceCard,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: AppColors.primary.withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(Icons.business, size: 22, color: AppColors.primary),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Contact Us',
                      style: TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w600,
                          color: AppColors.textPrimary)),
                  const SizedBox(height: 2),
                  Text('Office hours, address, email',
                      style: TextStyle(
                          fontSize: 12, color: AppColors.textSecondary)),
                ],
              ),
            ),
            Icon(Icons.chevron_right, size: 20, color: AppColors.textSecondary),
          ],
        ),
      ),
    );
  }

  Widget _buildEmptyCard(String message) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: AppColors.surfaceCard,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Center(
        child: Text(
          message,
          style: TextStyle(color: Colors.grey.shade500),
        ),
      ),
    );
  }

  Widget _buildAppointmentCard(Appointment appointment) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surfaceCard,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: AppColors.primary.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  '${appointment.appointmentDate.day}',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                    color: AppColors.primary,
                  ),
                ),
                Text(
                  monthAbbr(appointment.appointmentDate.month),
                  style: TextStyle(
                    fontSize: 10,
                    color: AppColors.primary,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  appointment.appointmentType.name.replaceAll('_', ' '),
                  style: TextStyle(
                    fontWeight: FontWeight.w600,
                    color: AppColors.textDark,
                  ),
                ),
                Text(
                  '${formatTime(appointment.appointmentDate)} - ${appointment.duration} min',
                  style: TextStyle(
                    fontSize: 13,
                    color: Colors.grey.shade600,
                  ),
                ),
              ],
            ),
          ),
          StatusChip.appointment(appointment.status.name),
        ],
      ),
    );
  }

  Widget _buildMessageCard(MessageThread thread) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.surfaceCard,
        borderRadius: BorderRadius.circular(12),
        border: thread.unreadForPatient
            ? Border.all(color: AppColors.primary, width: 1)
            : null,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (thread.unreadForPatient)
                Container(
                  width: 8,
                  height: 8,
                  margin: const EdgeInsets.only(right: 8),
                  decoration: BoxDecoration(
                    color: AppColors.primary,
                    shape: BoxShape.circle,
                  ),
                ),
              Expanded(
                child: Text(
                  thread.subject,
                  style: TextStyle(
                    fontWeight: thread.unreadForPatient
                        ? FontWeight.w600
                        : FontWeight.w500,
                    color: AppColors.textDark,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          if (thread.lastMessage != null) ...[
            const SizedBox(height: 4),
            Text(
              thread.lastMessage!,
              style: TextStyle(
                fontSize: 13,
                color: Colors.grey.shade600,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ],
      ),
    );
  }

}
