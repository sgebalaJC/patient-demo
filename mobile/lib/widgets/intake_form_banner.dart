import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/intake_form.dart';
import '../providers/auth_provider.dart';
import '../screens/intake/intake_forms_screen.dart';
import '../services/firestore/intake_forms_service.dart';

/// Persistent intake-form nag banner, mirroring the web's `IntakeFormBanner`.
/// Mounted in `MainShell` so it shows on every tab.
///
/// Visible when there is no form yet (`needs_intake`) OR an existing form is
/// `draft`/`in_progress` and the admin has written back `reviewNotes`
/// (`sent_back`). Respects `userProfile.intakeFormSkipped`.
class IntakeFormBanner extends StatefulWidget {
  const IntakeFormBanner({super.key});

  @override
  State<IntakeFormBanner> createState() => _IntakeFormBannerState();
}

enum _BannerState { loading, hidden, needsIntake, sentBack }

class _IntakeFormBannerState extends State<IntakeFormBanner> {
  _BannerState _state = _BannerState.loading;
  String? _loadedForUid;

  Future<void> _check(String uid) async {
    try {
      final form = await IntakeFormsService().getPatientIntakeForm(uid);
      if (!mounted) return;
      if (form == null) {
        setState(() => _state = _BannerState.needsIntake);
        return;
      }
      if (form.status == IntakeFormStatus.completed ||
          form.status == IntakeFormStatus.approved) {
        setState(() => _state = _BannerState.hidden);
        return;
      }
      if (form.reviewNotes != null) {
        setState(() => _state = _BannerState.sentBack);
      } else {
        setState(() => _state = _BannerState.needsIntake);
      }
    } catch (_) {
      if (mounted) setState(() => _state = _BannerState.hidden);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final profile = auth.userProfile;
    final uid = auth.firebaseUser?.uid;

    if (profile == null || uid == null || profile.intakeFormSkipped) {
      return const SizedBox.shrink();
    }

    // Lazy-load once per uid. Re-check if the user swaps (shouldn't happen
    // in normal flows, but dispose/rebuild through adminBlocked → signOut →
    // login can cause it).
    if (_loadedForUid != uid) {
      _loadedForUid = uid;
      WidgetsBinding.instance.addPostFrameCallback((_) => _check(uid));
    }

    if (_state == _BannerState.loading || _state == _BannerState.hidden) {
      return const SizedBox.shrink();
    }

    final isSentBack = _state == _BannerState.sentBack;
    return Material(
      color: Colors.amber.shade50,
      child: InkWell(
        onTap: () async {
          await Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => const IntakeFormsScreen()),
          );
          if (!mounted) return;
          // Re-check status on return — user may have submitted.
          _check(uid);
        },
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 10, 10, 10),
          child: Row(
            children: [
              Icon(Icons.description_outlined,
                  size: 18, color: Colors.amber.shade800),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      isSentBack
                          ? 'Your intake forms need attention'
                          : 'Complete your intake forms',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: Colors.amber.shade900,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      isSentBack
                          ? 'Your provider requested updates — tap to review and resubmit.'
                          : 'Patient info, medical history, and consent — tap to begin.',
                      style: TextStyle(
                        fontSize: 12,
                        color: Colors.amber.shade800,
                      ),
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right, color: Colors.amber.shade800),
              if (!isSentBack)
                IconButton(
                  onPressed: () {
                    setState(() => _state = _BannerState.hidden);
                    final auth = context.read<AuthProvider>();
                    final u = auth.firebaseUser?.uid;
                    if (u != null) {
                      // Fire-and-forget — matches web's optimistic skip.
                      IntakeFormsService()
                          .markSkipped(u)
                          .catchError((_) {});
                    }
                  },
                  icon: Icon(Icons.close,
                      size: 16, color: Colors.amber.shade700),
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(
                      minWidth: 32, minHeight: 32),
                  tooltip: 'Skip for now',
                ),
            ],
          ),
        ),
      ),
    );
  }
}
