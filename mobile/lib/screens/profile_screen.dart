import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../providers/auth_provider.dart';
import '../config/constants.dart';
import '../config/colors.dart';
import '../config/branding.dart';
import '../services/biometric_service.dart';
import '../widgets/phone_verification_sheet.dart';
import '../widgets/page_header.dart';
import '../widgets/theme_selector.dart';
import '../widgets/subscription_status_card.dart';
import '../utils/phone.dart';
import 'intake/intake_forms_screen.dart';
import 'legal_screen.dart';

class ProfileScreen extends StatefulWidget {
  final VoidCallback? onBack;
  const ProfileScreen({super.key, this.onBack});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  bool _isEditing = false;
  bool _saving = false;
  String? _error;

  final _firstNameController = TextEditingController();
  final _lastNameController = TextEditingController();
  final _phoneController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _syncFormToProfile();
  }

  @override
  void dispose() {
    _firstNameController.dispose();
    _lastNameController.dispose();
    _phoneController.dispose();
    super.dispose();
  }

  void _syncFormToProfile() {
    final user = context.read<AuthProvider>().userProfile;
    _firstNameController.text = user?.firstName ?? '';
    _lastNameController.text = user?.lastName ?? '';
    _phoneController.text = user?.phoneNumber ?? '';
  }

  Future<void> _handleSave() async {
    final auth = context.read<AuthProvider>();
    final user = auth.userProfile;
    if (user == null) return;

    // If phone number changed and is not empty, require verification first.
    // Normalize first so we surface bad numbers before round-tripping the
    // Cloud Function / SMS provider.
    final phoneChanged = _phoneController.text.trim() != (user.phoneNumber ?? '');
    if (phoneChanged && _phoneController.text.trim().isNotEmpty) {
      final String normalized;
      try {
        normalized = normalizePhoneNumber(_phoneController.text);
      } on InvalidPhoneException {
        setState(() => _error = 'Please enter a valid 10-digit US phone number.');
        return;
      }
      PhoneVerificationSheet.show(
        context: context,
        phoneNumber: normalized,
        onVerified: (verifiedPhone) {
          // Phone already saved by Cloud Function; save the rest
          _phoneController.text = verifiedPhone;
          _saveProfile(phoneVerifiedByCloudFunction: true);
        },
      );
      return;
    }

    await _saveProfile();
  }

  Future<void> _saveProfile({bool phoneVerifiedByCloudFunction = false}) async {
    final auth = context.read<AuthProvider>();
    final uid = auth.firebaseUser?.uid;
    if (uid == null) return;

    setState(() {
      _saving = true;
      _error = null;
    });

    try {
      final updates = <String, dynamic>{
        'firstName': _firstNameController.text.trim(),
        'lastName': _lastNameController.text.trim(),
        'displayName':
            '${_firstNameController.text.trim()} ${_lastNameController.text.trim()}'.trim(),
        'updatedAt': FieldValue.serverTimestamp(),
      };

      // Only include phone if NOT being updated via verification
      // (verification Cloud Function handles the phone update + calendar sync).
      // Normalize to canonical 10-digit form so phone-OTP lookups can match.
      if (!phoneVerifiedByCloudFunction) {
        try {
          updates['phoneNumber'] = normalizePhoneNumber(_phoneController.text);
        } on InvalidPhoneException {
          if (mounted) {
            setState(() {
              _error = 'Please enter a valid 10-digit US phone number.';
              _saving = false;
            });
          }
          return;
        }
      }

      await FirebaseFirestore.instance
          .collection('users')
          .doc(uid)
          .update(updates);

      if (mounted) {
        setState(() {
          _isEditing = false;
          _saving = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = 'Failed to update profile';
          _saving = false;
        });
      }
    }
  }

  void _cancelEdit() {
    _syncFormToProfile();
    setState(() {
      _isEditing = false;
      _error = null;
    });
  }

  void _triggerVerification() {
    final user = context.read<AuthProvider>().userProfile;
    final phone = user?.phoneNumber;
    if (phone == null || phone.isEmpty) return;

    PhoneVerificationSheet.show(
      context: context,
      phoneNumber: phone,
      onVerified: (_) {
        // Profile auto-updates via real-time listener in AuthProvider
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final user = auth.userProfile;

    return Scaffold(
      backgroundColor: AppColors.background,
      body: Column(
        children: [
          PageHeader(
            icon: Icons.person_outline,
            title: 'Profile',
            subtitle: 'Your personal information',
            onBack: widget.onBack,
          ),
          Expanded(child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Avatar + name
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: AppColors.surfaceCard,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              children: [
                CircleAvatar(
                  radius: 40,
                  backgroundColor:
                      AppColors.primary.withValues(alpha: 0.1),
                  child: Text(
                    (user?.firstName?.isNotEmpty == true
                            ? user!.firstName![0]
                            : (user?.email?.isNotEmpty == true ? user!.email![0] : '?'))
                        .toUpperCase(),
                    style: TextStyle(
                      fontSize: 28,
                      fontWeight: FontWeight.bold,
                      color: AppColors.primary,
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  user?.fullName ?? '',
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                    color: AppColors.textDark,
                  ),
                ),
                if (user?.email?.isNotEmpty == true)
                  Text(
                    user!.email!,
                    style: TextStyle(color: Colors.grey.shade600),
                  )
                else if (user?.phoneNumber?.isNotEmpty == true)
                  Text(
                    formatPhoneDisplay(user!.phoneNumber),
                    style: TextStyle(color: Colors.grey.shade600),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 16),

          // Error
          if (_error != null) ...[
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.red.shade50,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                _error!,
                style: TextStyle(color: Colors.red.shade700, fontSize: 14),
              ),
            ),
            const SizedBox(height: 12),
          ],

          // Membership / billing status
          if (user != null) ...[
            SubscriptionStatusCard(uid: user.id),
            const SizedBox(height: 12),
          ],

          // Editable info section
          Container(
            decoration: BoxDecoration(
              color: AppColors.surfaceCard,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  // First Name
                  _buildField(
                    icon: Icons.person_outline,
                    label: 'First Name',
                    controller: _firstNameController,
                    maxLength: FieldLimits.firstNameMax,
                  ),
                  const Divider(height: 24),

                  // Last Name
                  _buildField(
                    icon: Icons.person_outline,
                    label: 'Last Name',
                    controller: _lastNameController,
                    maxLength: FieldLimits.lastNameMax,
                  ),
                  const Divider(height: 24),

                  // Phone
                  _buildPhoneField(),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),

          // Edit / Save buttons
          _isEditing
              ? Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: _saving ? null : _cancelEdit,
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
                        onPressed: _saving ? null : _handleSave,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.primary,
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(10),
                          ),
                        ),
                        child: _saving
                            ? const SizedBox(
                                width: 20,
                                height: 20,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Colors.white,
                                ),
                              )
                            : const Text(
                                'Save Changes',
                                style: TextStyle(fontWeight: FontWeight.w600),
                              ),
                      ),
                    ),
                  ],
                )
              : SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    onPressed: () => setState(() => _isEditing = true),
                    icon: const Icon(Icons.edit_outlined, size: 18),
                    label: const Text('Edit Profile',
                        style: TextStyle(fontWeight: FontWeight.w600)),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.primary,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                  ),
                ),
          const SizedBox(height: 16),

          // Actions
          Container(
            decoration: BoxDecoration(
              color: AppColors.surfaceCard,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              children: [
                ListTile(
                  leading: Icon(Icons.description_outlined,
                      color: Colors.grey.shade600),
                  title: const Text('Intake Forms'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () {
                    Navigator.of(context).push(MaterialPageRoute(
                      builder: (_) => const IntakeFormsScreen(),
                    ));
                  },
                ),
                const Divider(height: 1),
                _BiometricToggle(),
              ],
            ),
          ),
          const SizedBox(height: 16),

          // Theme
          const ThemeSelector(),
          const SizedBox(height: 16),

          // Export Data
          Container(
            decoration: BoxDecoration(
              color: AppColors.surfaceCard,
              borderRadius: BorderRadius.circular(12),
            ),
            child: ListTile(
              leading: Icon(Icons.download_rounded, color: AppColors.primary),
              title: const Text('Export My Data'),
              subtitle: const Text(
                'Download all your health records',
                style: TextStyle(fontSize: 12),
              ),
              trailing: const Icon(Icons.open_in_new, size: 18),
              onTap: () {
                final url = Uri.parse('https://${branding.domain}/profile');
                launchUrl(url, mode: LaunchMode.externalApplication);
              },
            ),
          ),
          const SizedBox(height: 16),

          // Legal
          Container(
            decoration: BoxDecoration(
              color: AppColors.surfaceCard,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              children: [
                ListTile(
                  leading: Icon(Icons.privacy_tip_outlined,
                      color: Colors.grey.shade600),
                  title: const Text('Privacy Policy'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) =>
                          const LegalScreen(document: LegalDocument.privacy),
                    ),
                  ),
                ),
                const Divider(height: 1),
                ListTile(
                  leading: Icon(Icons.description_outlined,
                      color: Colors.grey.shade600),
                  title: const Text('Terms of Service'),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) =>
                          const LegalScreen(document: LegalDocument.terms),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),

          // Delete Account (destructive, below legal to keep it out of reach).
          Container(
            decoration: BoxDecoration(
              color: AppColors.surfaceCard,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: Colors.red.shade200),
            ),
            child: ListTile(
              leading: Icon(Icons.delete_forever_outlined,
                  color: Colors.red.shade600),
              title: Text(
                'Delete Account',
                style: TextStyle(
                  color: Colors.red.shade700,
                  fontWeight: FontWeight.w600,
                ),
              ),
              subtitle: Text(
                'Permanently delete your account and data',
                style: TextStyle(fontSize: 12, color: Colors.grey.shade600),
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => _DeleteAccountDialog.show(context),
            ),
          ),
          const SizedBox(height: 24),

          // Sign out
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: () => auth.signOut(),
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.red,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                ),
              ),
              child: const Text(
                'Sign Out',
                style: TextStyle(fontWeight: FontWeight.w600),
              ),
            ),
          ),
        ],
      )),
        ],
      ),
    );
  }

  Widget _buildField({
    required IconData icon,
    required String label,
    required TextEditingController controller,
    int? maxLength,
    TextInputType? keyboardType,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, color: Colors.grey.shade500, size: 20),
        const SizedBox(width: 12),
        Expanded(
          child: _isEditing
              ? TextField(
                  controller: controller,
                  maxLength: maxLength,
                  keyboardType: keyboardType,
                  decoration: InputDecoration(
                    labelText: label,
                    counterText: '',
                    isDense: true,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                  ),
                )
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(label,
                        style:
                            TextStyle(fontSize: 12, color: Colors.grey.shade500)),
                    const SizedBox(height: 2),
                    Text(
                      controller.text.isNotEmpty ? controller.text : 'Not set',
                      style: TextStyle(
                        fontWeight: FontWeight.w500,
                        color: AppColors.textDark,
                      ),
                    ),
                  ],
                ),
        ),
      ],
    );
  }

  Widget _buildPhoneField() {
    final user = context.watch<AuthProvider>().userProfile;
    final hasPhone = user?.phoneNumber != null && user!.phoneNumber!.isNotEmpty;
    final isVerified = user?.phoneVerified == true;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(Icons.phone_outlined, color: Colors.grey.shade500, size: 20),
        const SizedBox(width: 12),
        Expanded(
          child: _isEditing
              ? TextField(
                  controller: _phoneController,
                  maxLength: FieldLimits.phoneNumberMax,
                  keyboardType: TextInputType.phone,
                  decoration: InputDecoration(
                    labelText: 'Phone Number',
                    counterText: '',
                    isDense: true,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                  ),
                )
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Phone Number',
                        style:
                            TextStyle(fontSize: 12, color: Colors.grey.shade500)),
                    const SizedBox(height: 2),
                    Row(
                      children: [
                        Text(
                          hasPhone ? formatPhoneDisplay(user.phoneNumber) : 'Not set',
                          style: TextStyle(
                            fontWeight: FontWeight.w500,
                            color: AppColors.textDark,
                          ),
                        ),
                        if (hasPhone) ...[
                          const SizedBox(width: 8),
                          if (isVerified)
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 8, vertical: 2),
                              decoration: BoxDecoration(
                                color: Colors.green.shade50,
                                borderRadius: BorderRadius.circular(12),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(Icons.check_circle,
                                      size: 12, color: Colors.green.shade700),
                                  const SizedBox(width: 4),
                                  Text(
                                    'Verified',
                                    style: TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w500,
                                      color: Colors.green.shade700,
                                    ),
                                  ),
                                ],
                              ),
                            )
                          else
                            GestureDetector(
                              onTap: _triggerVerification,
                              child: Container(
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 8, vertical: 2),
                                decoration: BoxDecoration(
                                  color: AppColors.primary
                                      .withValues(alpha: 0.1),
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Icon(Icons.verified_user_outlined,
                                        size: 12,
                                        color: AppColors.primary),
                                    const SizedBox(width: 4),
                                    Text(
                                      'Verify',
                                      style: TextStyle(
                                        fontSize: 11,
                                        fontWeight: FontWeight.w600,
                                        color: AppColors.primary,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                        ],
                      ],
                    ),
                  ],
                ),
        ),
      ],
    );
  }
}

class _BiometricToggle extends StatefulWidget {
  @override
  State<_BiometricToggle> createState() => _BiometricToggleState();
}

class _BiometricToggleState extends State<_BiometricToggle> {
  final _service = BiometricService();
  bool _available = false;
  bool _enabled = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final available = await _service.isAvailable();
    final enabled = await _service.isEnabled();
    if (mounted) {
      setState(() {
        _available = available;
        _enabled = enabled;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_available) return const SizedBox.shrink();

    return SwitchListTile(
      secondary: Icon(Icons.fingerprint, color: Colors.grey.shade600),
      title: const Text('Biometric Login'),
      subtitle: Text(
        _enabled ? 'Enabled' : 'Disabled',
        style: TextStyle(fontSize: 13, color: Colors.grey.shade600),
      ),
      value: _enabled,
      activeTrackColor: AppColors.primary,
      onChanged: (value) async {
        await _service.setEnabled(value);
        setState(() => _enabled = value);
      },
    );
  }
}

/// Destructive delete-account flow, mirroring the web `ProfilePage` modal.
/// Calls the `deleteAccount` Cloud Function and signs the user out on success.
/// Requires the literal "DELETE" string so a misclick can't trigger deletion.
class _DeleteAccountDialog extends StatefulWidget {
  static Future<void> show(BuildContext context) {
    return showDialog(
      context: context,
      builder: (_) => const _DeleteAccountDialog(),
    );
  }

  const _DeleteAccountDialog();

  @override
  State<_DeleteAccountDialog> createState() => _DeleteAccountDialogState();
}

class _DeleteAccountDialogState extends State<_DeleteAccountDialog> {
  final _confirmController = TextEditingController();
  bool _deleting = false;
  String? _error;

  @override
  void dispose() {
    _confirmController.dispose();
    super.dispose();
  }

  Future<void> _delete() async {
    if (_confirmController.text.trim() != 'DELETE') return;
    setState(() {
      _deleting = true;
      _error = null;
    });
    try {
      final fn = FirebaseFunctions.instance.httpsCallable('deleteAccount');
      final result = await fn.call({});
      final data = Map<String, dynamic>.from(result.data as Map);
      if (data['success'] == true) {
        // Clear state and route back to the auth gate — AuthProvider's
        // profile listener will pick up the deletion.
        if (!mounted) return;
        Navigator.of(context).pop();
        await context.read<AuthProvider>().signOut();
      } else {
        if (!mounted) return;
        setState(() {
          _error = (data['error'] as String?) ?? 'Failed to delete account';
          _deleting = false;
        });
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'Failed to delete account. Please try again later.';
        _deleting = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Delete your account?'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'This will permanently delete your profile, messages, appointments, and documents. This action cannot be undone.',
            style: TextStyle(color: Colors.grey.shade700, height: 1.4),
          ),
          const SizedBox(height: 16),
          Text(
            'Type DELETE to confirm.',
            style: TextStyle(
              fontWeight: FontWeight.w600,
              color: AppColors.textDark,
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _confirmController,
            autocorrect: false,
            enableSuggestions: false,
            textCapitalization: TextCapitalization.characters,
            decoration: InputDecoration(
              hintText: 'DELETE',
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
              ),
            ),
            onChanged: (_) => setState(() {}),
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!,
                style: TextStyle(color: Colors.red.shade700, fontSize: 13)),
          ],
        ],
      ),
      actions: [
        TextButton(
          onPressed:
              _deleting ? null : () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        ElevatedButton(
          onPressed: (_confirmController.text.trim() == 'DELETE' && !_deleting)
              ? _delete
              : null,
          style: ElevatedButton.styleFrom(
            backgroundColor: Colors.red.shade600,
            foregroundColor: Colors.white,
          ),
          child: _deleting
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: Colors.white,
                  ),
                )
              : const Text('Delete Account'),
        ),
      ],
    );
  }
}
