import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:cloud_functions/cloud_functions.dart';
import '../config/colors.dart';
import 'bottom_sheet_header.dart';

/// Bottom sheet for phone number verification via Twilio SMS.
///
/// Two-step flow:
/// 1. Send step: Shows masked phone, user taps "Send Code"
/// 2. Verify step: User enters 6-digit code, taps "Verify"
///
/// Calls existing Cloud Functions:
/// - sendPhoneVerificationCode({ phoneNumber })
/// - verifyPhoneCode({ code })
class PhoneVerificationSheet extends StatefulWidget {
  final String phoneNumber;
  final void Function(String verifiedPhone) onVerified;

  const PhoneVerificationSheet({
    super.key,
    required this.phoneNumber,
    required this.onVerified,
  });

  /// Show the verification sheet as a modal bottom sheet.
  static Future<void> show({
    required BuildContext context,
    required String phoneNumber,
    required void Function(String verifiedPhone) onVerified,
  }) {
    return showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => PhoneVerificationSheet(
        phoneNumber: phoneNumber,
        onVerified: onVerified,
      ),
    );
  }

  @override
  State<PhoneVerificationSheet> createState() => _PhoneVerificationSheetState();
}

enum _Step { send, verify }

class _PhoneVerificationSheetState extends State<PhoneVerificationSheet> {
  final _codeController = TextEditingController();
  final _functions = FirebaseFunctions.instance;

  _Step _step = _Step.send;
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _codeController.dispose();
    super.dispose();
  }

  String get _maskedPhone {
    final digits = widget.phoneNumber.replaceAll(RegExp(r'\D'), '');
    if (digits.length == 10) {
      return '(${digits.substring(0, 3)}) ${digits.substring(3, 6)}-${digits.substring(6)}';
    }
    if (digits.length == 11 && digits.startsWith('1')) {
      return '(${digits.substring(1, 4)}) ${digits.substring(4, 7)}-${digits.substring(7)}';
    }
    return widget.phoneNumber;
  }

  Future<void> _sendCode() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final result = await _functions
          .httpsCallable('sendPhoneVerificationCode')
          .call({'phoneNumber': widget.phoneNumber});

      final data = result.data as Map<String, dynamic>;
      if (data['success'] == true) {
        setState(() => _step = _Step.verify);
      } else {
        setState(() => _error = data['error'] ?? 'Failed to send verification code');
      }
    } on FirebaseFunctionsException catch (e) {
      setState(() => _error = e.message ?? 'Failed to send verification code');
    } catch (e) {
      setState(() => _error = 'Failed to send verification code');
    } finally {
      setState(() => _loading = false);
    }
  }

  Future<void> _verifyCode() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final result = await _functions
          .httpsCallable('verifyPhoneCode')
          .call({'code': _codeController.text});

      final data = result.data as Map<String, dynamic>;
      if (data['success'] == true) {
        final verifiedPhone = data['phoneNumber'] as String? ?? widget.phoneNumber;
        if (mounted) {
          Navigator.pop(context);
          widget.onVerified(verifiedPhone);
        }
      } else {
        setState(() => _error = data['error'] ?? 'Verification failed');
      }
    } on FirebaseFunctionsException catch (e) {
      setState(() => _error = e.message ?? 'Verification failed');
    } catch (e) {
      setState(() => _error = 'Verification failed');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _resend() {
    setState(() {
      _step = _Step.send;
      _codeController.clear();
      _error = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;

    return Container(
      padding: EdgeInsets.only(bottom: bottomInset),
      decoration: BoxDecoration(
        color: AppColors.surfaceCard,
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              BottomSheetHeader(
                icon: Icons.verified_user_outlined,
                color: AppColors.primary,
                title: 'Verify Phone Number',
              ),
              const SizedBox(height: 20),

              // Error
              if (_error != null) ...[
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.red.shade50,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    _error!,
                    style: TextStyle(
                      color: Colors.red.shade700,
                      fontSize: 14,
                    ),
                  ),
                ),
                const SizedBox(height: 16),
              ],

              // Step content
              if (_step == _Step.send) _buildSendStep(),
              if (_step == _Step.verify) _buildVerifyStep(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSendStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          "We'll send a verification code via SMS to:",
          style: TextStyle(
            fontSize: 14,
            color: Colors.grey.shade600,
          ),
        ),
        const SizedBox(height: 12),

        // Phone display
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: AppColors.background,
            borderRadius: BorderRadius.circular(10),
          ),
          child: Row(
            children: [
              Icon(Icons.phone_outlined, color: Colors.grey.shade500, size: 20),
              const SizedBox(width: 12),
              Text(
                _maskedPhone,
                style: TextStyle(
                  fontWeight: FontWeight.w600,
                  fontSize: 16,
                  color: AppColors.textDark,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 20),

        // Buttons
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                onPressed: _loading ? null : () => Navigator.pop(context),
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                  ),
                ),
                child: const Text('Cancel'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: ElevatedButton(
                onPressed: _loading ? null : _sendCode,
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                  ),
                ),
                child: _loading
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Text(
                        'Send Code',
                        style: TextStyle(fontWeight: FontWeight.w600),
                      ),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildVerifyStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        RichText(
          text: TextSpan(
            style: TextStyle(fontSize: 14, color: Colors.grey.shade600),
            children: [
              const TextSpan(text: 'Enter the 6-digit code sent to '),
              TextSpan(
                text: _maskedPhone,
                style: TextStyle(fontWeight: FontWeight.w600, color: AppColors.textDark),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),

        // Code input
        TextField(
          controller: _codeController,
          keyboardType: TextInputType.number,
          textAlign: TextAlign.center,
          maxLength: 6,
          autofocus: true,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          style: TextStyle(
            fontSize: 28,
            fontWeight: FontWeight.w600,
            letterSpacing: 12,
            fontFamily: 'monospace',
          ),
          decoration: InputDecoration(
            counterText: '',
            hintText: '000000',
            hintStyle: TextStyle(
              color: Colors.grey.shade300,
              fontSize: 28,
              fontWeight: FontWeight.w600,
              letterSpacing: 12,
              fontFamily: 'monospace',
            ),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
            ),
            contentPadding: const EdgeInsets.symmetric(vertical: 16),
          ),
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: 16),

        // Resend + buttons
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            TextButton(
              onPressed: _loading ? null : _resend,
              child: const Text(
                'Resend code',
                style: TextStyle(fontWeight: FontWeight.w500),
              ),
            ),
            Row(
              children: [
                OutlinedButton(
                  onPressed: _loading ? null : () => Navigator.pop(context),
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                  ),
                  child: const Text('Cancel'),
                ),
                const SizedBox(width: 10),
                ElevatedButton(
                  onPressed: _loading || _codeController.text.length != 6
                      ? null
                      : _verifyCode,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                  ),
                  child: _loading
                      ? const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Text(
                          'Verify',
                          style: TextStyle(fontWeight: FontWeight.w600),
                        ),
                ),
              ],
            ),
          ],
        ),
      ],
    );
  }
}
