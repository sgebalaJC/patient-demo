import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../providers/auth_provider.dart';
import '../../config/colors.dart';

class PhoneLoginScreen extends StatefulWidget {
  const PhoneLoginScreen({super.key});

  @override
  State<PhoneLoginScreen> createState() => _PhoneLoginScreenState();
}

enum _Step { phone, code, name }

class _PhoneLoginScreenState extends State<PhoneLoginScreen> {
  final _phoneController = TextEditingController();
  final _codeController = TextEditingController();
  final _firstNameController = TextEditingController();
  final _lastNameController = TextEditingController();
  _Step _step = _Step.phone;
  String? _error;
  bool _loading = false;
  int _cooldown = 0;

  @override
  void dispose() {
    _phoneController.dispose();
    _codeController.dispose();
    _firstNameController.dispose();
    _lastNameController.dispose();
    super.dispose();
  }

  void _startCooldown() {
    _cooldown = 30;
    Future.doWhile(() async {
      await Future.delayed(const Duration(seconds: 1));
      if (!mounted) return false;
      setState(() => _cooldown--);
      return _cooldown > 0;
    });
  }

  Future<void> _sendCode() async {
    if (_phoneController.text.trim().isEmpty) {
      setState(() => _error = 'Phone number is required');
      return;
    }
    setState(() { _loading = true; _error = null; });
    try {
      final auth = context.read<AuthProvider>();
      final result = await auth.sendPhoneLoginCode(_phoneController.text.trim());
      if (result['success'] == true) {
        setState(() => _step = _Step.code);
        _startCooldown();
      } else {
        setState(() => _error = result['error'] ?? 'Failed to send code');
      }
    } catch (e) {
      setState(() => _error = 'Failed to send verification code');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _verifyCode() async {
    final code = _codeController.text.trim();
    if (code.length != 6) {
      setState(() => _error = 'Please enter a 6-digit code');
      return;
    }
    setState(() { _loading = true; _error = null; });
    try {
      final auth = context.read<AuthProvider>();
      final result = await auth.verifyPhoneLogin(
        _phoneController.text.trim(),
        code,
        firstName: _firstNameController.text.trim().isNotEmpty
            ? _firstNameController.text.trim()
            : null,
        lastName: _lastNameController.text.trim().isNotEmpty
            ? _lastNameController.text.trim()
            : null,
      );
      if (result['success'] == true && result['needsName'] == true) {
        setState(() => _step = _Step.name);
      } else if (result['success'] == true) {
        // Signed in — auth state change handles navigation
      } else {
        setState(() => _error = result['error'] ?? 'Verification failed');
      }
    } catch (e) {
      setState(() => _error = 'Verification failed');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _submitName() async {
    final first = _firstNameController.text.trim();
    final last = _lastNameController.text.trim();
    if (first.length < 2 || last.length < 2) {
      setState(() => _error = 'First and last name must be at least 2 characters');
      return;
    }
    // Need to get a new code since the previous one was consumed
    setState(() { _loading = true; _error = null; });
    try {
      final auth = context.read<AuthProvider>();
      final sendResult = await auth.sendPhoneLoginCode(_phoneController.text.trim());
      if (sendResult['success'] == true) {
        setState(() { _step = _Step.code; _codeController.clear(); });
        _startCooldown();
      } else {
        setState(() => _error = sendResult['error'] ?? 'Failed to send code');
      }
    } catch (e) {
      setState(() => _error = 'Failed to complete registration');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _resendCode() async {
    if (_cooldown > 0) return;
    setState(() { _loading = true; _error = null; });
    try {
      final auth = context.read<AuthProvider>();
      final result = await auth.sendPhoneLoginCode(_phoneController.text.trim());
      if (result['success'] == true) {
        _codeController.clear();
        _startCooldown();
      } else {
        setState(() => _error = result['error'] ?? 'Failed to resend code');
      }
    } catch (e) {
      setState(() => _error = 'Failed to resend code');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(
          _step == _Step.name ? 'Complete Profile' : 'Phone Sign In',
          style: TextStyle(color: AppColors.textDark),
        ),
        backgroundColor: Colors.transparent,
        elevation: 0,
        iconTheme: IconThemeData(color: AppColors.textDark),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Icon
              Icon(
                _step == _Step.name ? Icons.person_outline : Icons.phone_outlined,
                size: 56,
                color: AppColors.primary,
              ),
              const SizedBox(height: 16),

              // Title
              Text(
                _step == _Step.phone
                    ? 'Enter your phone number'
                    : _step == _Step.code
                        ? 'Enter verification code'
                        : 'Complete your profile',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.bold,
                  color: AppColors.textDark,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                _step == _Step.phone
                    ? 'We\'ll send you a verification code'
                    : _step == _Step.code
                        ? 'Code sent to ${_phoneController.text}'
                        : 'Enter your name to create your account',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 14, color: AppColors.textMedium),
              ),
              const SizedBox(height: 24),

              // Error
              if (_error != null)
                Container(
                  padding: const EdgeInsets.all(12),
                  margin: const EdgeInsets.only(bottom: 16),
                  decoration: BoxDecoration(
                    color: AppColors.errorBg,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(_error!,
                      style: TextStyle(color: AppColors.error, fontSize: 14)),
                ),

              // Step: Phone
              if (_step == _Step.phone) ...[
                TextField(
                  controller: _phoneController,
                  keyboardType: TextInputType.phone,
                  decoration: InputDecoration(
                    labelText: 'Phone Number',
                    hintText: '(555) 555-5555',
                    prefixIcon: const Icon(Icons.phone_outlined),
                    border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(10)),
                  ),
                ),
                const SizedBox(height: 16),
                ElevatedButton(
                  onPressed: _loading ? null : _sendCode,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10)),
                  ),
                  child: _loading
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: Colors.white))
                      : const Text('Send Code',
                          style: TextStyle(fontWeight: FontWeight.w600)),
                ),
              ],

              // Step: Code
              if (_step == _Step.code) ...[
                TextField(
                  controller: _codeController,
                  keyboardType: TextInputType.number,
                  maxLength: 6,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                      fontSize: 24, letterSpacing: 8, fontFamily: 'monospace'),
                  decoration: InputDecoration(
                    counterText: '',
                    hintText: '000000',
                    border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(10)),
                  ),
                ),
                const SizedBox(height: 16),
                ElevatedButton(
                  onPressed: _loading || _codeController.text.length != 6
                      ? null
                      : _verifyCode,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10)),
                  ),
                  child: _loading
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: Colors.white))
                      : const Text('Verify & Sign In',
                          style: TextStyle(fontWeight: FontWeight.w600)),
                ),
                const SizedBox(height: 12),
                TextButton(
                  onPressed: _cooldown > 0 || _loading ? null : _resendCode,
                  child: Text(
                    _cooldown > 0
                        ? 'Resend code in ${_cooldown}s'
                        : 'Resend code',
                    style: TextStyle(color: AppColors.primary),
                  ),
                ),
                TextButton(
                  onPressed: () => setState(() {
                    _step = _Step.phone;
                    _codeController.clear();
                    _error = null;
                  }),
                  child: Text('Use a different number',
                      style: TextStyle(color: AppColors.textMedium)),
                ),
              ],

              // Step: Name
              if (_step == _Step.name) ...[
                TextField(
                  controller: _firstNameController,
                  textCapitalization: TextCapitalization.words,
                  decoration: InputDecoration(
                    labelText: 'First Name',
                    border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(10)),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _lastNameController,
                  textCapitalization: TextCapitalization.words,
                  decoration: InputDecoration(
                    labelText: 'Last Name',
                    border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(10)),
                  ),
                ),
                const SizedBox(height: 16),
                ElevatedButton(
                  onPressed: _loading ? null : _submitName,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10)),
                  ),
                  child: _loading
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: Colors.white))
                      : const Text('Continue',
                          style: TextStyle(fontWeight: FontWeight.w600)),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
