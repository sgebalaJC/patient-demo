import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../config/colors.dart';
import '../../config/constants.dart';
import '../../providers/auth_provider.dart';

/// Passwordless email-link sign-in.
///
/// Mirrors the web's `EmailLinkLoginForm`. Two-step flow:
///  1. Enter email → Firebase emails a sign-in link.
///  2. Tap the link. If the OS routes the tap to this app (App Links /
///     Universal Links — not configured out of the box), the deep-link
///     handler completes sign-in. Otherwise, the patient pastes the URL
///     back into the field below and we call `signInWithEmailLink`
///     directly.
///
/// Same used-by-admin-invite flow as `sendInviteLink` on web: an admin
/// creating a passwordless patient from the web portal generates the same
/// kind of link, so an invited patient can land here by entering their
/// email and requesting a fresh link at any time.
class EmailLinkLoginScreen extends StatefulWidget {
  const EmailLinkLoginScreen({super.key});

  @override
  State<EmailLinkLoginScreen> createState() => _EmailLinkLoginScreenState();
}

class _EmailLinkLoginScreenState extends State<EmailLinkLoginScreen> {
  final _emailController = TextEditingController();
  final _linkController = TextEditingController();
  bool _linkSent = false;

  @override
  void initState() {
    super.initState();
    // If the patient is returning after requesting a link on this device,
    // pre-fill their email so they can paste the link immediately.
    context.read<AuthProvider>().getStoredEmailForSignIn().then((email) {
      if (email != null && mounted) {
        setState(() {
          _emailController.text = email;
          _linkSent = true;
        });
      }
    });
  }

  @override
  void dispose() {
    _emailController.dispose();
    _linkController.dispose();
    super.dispose();
  }

  Future<void> _sendLink() async {
    final email = _emailController.text.trim();
    if (email.isEmpty || !email.contains('@')) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter a valid email address')),
      );
      return;
    }
    final auth = context.read<AuthProvider>();
    auth.clearError();
    final ok = await auth.sendSignInLink(email);
    if (ok && mounted) {
      setState(() => _linkSent = true);
    }
  }

  Future<void> _completeSignIn() async {
    final email = _emailController.text.trim();
    final link = _linkController.text.trim();
    if (email.isEmpty || link.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Paste the full sign-in link from your email'),
        ),
      );
      return;
    }
    final auth = context.read<AuthProvider>();
    auth.clearError();
    final ok = await auth.completeEmailLinkSignIn(email: email, link: link);
    if (ok && mounted) {
      Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        foregroundColor: AppColors.textDark,
        title: const Text('Email sign-in link'),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Consumer<AuthProvider>(
            builder: (context, auth, _) {
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Icon(Icons.mark_email_read_outlined,
                      size: 48, color: AppColors.primary),
                  const SizedBox(height: 12),
                  Text(
                    _linkSent
                        ? 'Check your email'
                        : 'Sign in without a password',
                    style: TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textDark,
                    ),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    _linkSent
                        ? 'We emailed a sign-in link to ${_emailController.text.trim()}. '
                            'Tap it to sign in, or paste it below if your email app opens it in a browser.'
                        : 'Enter your email address and we\'ll send you a one-time sign-in link. '
                            'No password needed.',
                    style: TextStyle(color: Colors.grey.shade600, height: 1.4),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 24),
                  if (auth.error != null) ...[
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: Colors.red.shade50,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        auth.error!,
                        style: TextStyle(color: Colors.red.shade700),
                        textAlign: TextAlign.center,
                      ),
                    ),
                    const SizedBox(height: 16),
                  ],
                  TextField(
                    controller: _emailController,
                    keyboardType: TextInputType.emailAddress,
                    autocorrect: false,
                    maxLength: FieldLimits.emailMax,
                    decoration: InputDecoration(
                      labelText: 'Email',
                      prefixIcon: const Icon(Icons.email_outlined),
                      counterText: '',
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  SizedBox(
                    height: 48,
                    child: ElevatedButton(
                      onPressed: auth.loading ? null : _sendLink,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.primary,
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10),
                        ),
                      ),
                      child: auth.loading
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : Text(_linkSent ? 'Resend link' : 'Email me a link'),
                    ),
                  ),
                  if (_linkSent) ...[
                    const SizedBox(height: 32),
                    Row(
                      children: [
                        Expanded(child: Divider(color: Colors.grey.shade300)),
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 12),
                          child: Text(
                            'or paste link',
                            style: TextStyle(color: Colors.grey.shade500),
                          ),
                        ),
                        Expanded(child: Divider(color: Colors.grey.shade300)),
                      ],
                    ),
                    const SizedBox(height: 16),
                    TextField(
                      controller: _linkController,
                      keyboardType: TextInputType.url,
                      autocorrect: false,
                      maxLines: 3,
                      decoration: InputDecoration(
                        labelText: 'Sign-in link',
                        hintText: 'https://...',
                        alignLabelWithHint: true,
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(10),
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    SizedBox(
                      height: 48,
                      child: OutlinedButton(
                        onPressed: auth.loading ? null : _completeSignIn,
                        style: OutlinedButton.styleFrom(
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(10),
                          ),
                        ),
                        child: const Text('Sign in with pasted link'),
                      ),
                    ),
                  ],
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}
