import 'package:firebase_auth/firebase_auth.dart' show FirebaseAuth;
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../config/branding.dart';
import '../providers/auth_provider.dart';

/// Persistent "please verify your email" banner, mirroring the web's
/// `EmailVerificationBanner`. Mounted above the tab scaffold in `MainShell`
/// so it follows the patient across Dashboard / Appointments / Messages /
/// Refills / Profile.
///
/// Only shows when the Firebase user has email/password or email-link
/// credentials without a verified email. Patients who signed in via phone
/// OTP won't have an email and are correctly excluded.
class EmailVerificationBanner extends StatefulWidget {
  const EmailVerificationBanner({super.key});

  @override
  State<EmailVerificationBanner> createState() =>
      _EmailVerificationBannerState();
}

class _EmailVerificationBannerState extends State<EmailVerificationBanner> {
  bool _busy = false;
  String? _message;

  Future<void> _resend() async {
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      await FirebaseAuth.instance.currentUser?.sendEmailVerification();
      if (!mounted) return;
      setState(() => _message =
          'Verification email sent. Check your inbox (and spam folder).');
    } catch (_) {
      if (!mounted) return;
      setState(() =>
          _message = 'Could not send verification email. Please try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _checkStatus() async {
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      await FirebaseAuth.instance.currentUser?.reload();
      if (!mounted) return;
      final verified =
          FirebaseAuth.instance.currentUser?.emailVerified ?? false;
      if (verified) {
        // Banner will unmount on next build via AuthProvider rebroadcast.
        return;
      }
      setState(() => _message =
          'Still not verified. Tap the link in your email then try again.');
    } catch (_) {
      if (!mounted) return;
      setState(() => _message = 'Could not check status. Please try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    // React to auth-state changes — the banner should unmount the moment
    // emailVerified flips to true, without waiting for a rebuild trigger.
    context.watch<AuthProvider>();
    final user = FirebaseAuth.instance.currentUser;
    if (user == null || user.email == null || user.emailVerified) {
      return const SizedBox.shrink();
    }

    return Container(
      color: Colors.amber.shade50,
      padding: const EdgeInsets.fromLTRB(14, 10, 10, 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.mail_outline,
                  size: 18, color: Colors.amber.shade800),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Please verify your email address.',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: Colors.amber.shade900,
                  ),
                ),
              ),
              TextButton(
                onPressed: _busy ? null : _resend,
                style: TextButton.styleFrom(
                  foregroundColor: Colors.amber.shade900,
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  minimumSize: const Size(0, 32),
                ),
                child: const Text('Resend',
                    style: TextStyle(fontWeight: FontWeight.w600)),
              ),
              TextButton(
                onPressed: _busy ? null : _checkStatus,
                style: TextButton.styleFrom(
                  foregroundColor: Colors.amber.shade900,
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  minimumSize: const Size(0, 32),
                ),
                child: const Text('I verified',
                    style: TextStyle(fontWeight: FontWeight.w600)),
              ),
            ],
          ),
          if (_message != null)
            Padding(
              padding: const EdgeInsets.only(top: 2, left: 28, right: 4),
              child: Text(
                _message!,
                style: TextStyle(
                  fontSize: 12,
                  color: Colors.amber.shade900,
                ),
              ),
            )
          else
            Padding(
              padding: const EdgeInsets.only(top: 2, left: 28, right: 4),
              child: Text(
                'Check your spam folder — emails from ${branding.fromEmail} can end up there.',
                style: TextStyle(
                  fontSize: 12,
                  color: Colors.amber.shade800,
                ),
              ),
            ),
        ],
      ),
    );
  }
}
