import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../providers/auth_provider.dart';
import '../../services/firestore/specialist_requests_service.dart';
import '../../services/firestore/notification_helper.dart';
import '../../config/colors.dart';
import '../../config/specialists.dart';
import '../../config/constants.dart';
import '../../widgets/bottom_sheet_header.dart';

class RequestSpecialistSheet extends StatefulWidget {
  final VoidCallback? onRequested;

  const RequestSpecialistSheet({super.key, this.onRequested});

  static Future<void> show(BuildContext context, {VoidCallback? onRequested}) {
    return showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => RequestSpecialistSheet(onRequested: onRequested),
    );
  }

  @override
  State<RequestSpecialistSheet> createState() => _RequestSpecialistSheetState();
}

class _RequestSpecialistSheetState extends State<RequestSpecialistSheet> {
  final _service = SpecialistRequestsService();
  final _reasonController = TextEditingController();
  final _notesController = TextEditingController();

  String? _selectedType;
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _reasonController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_selectedType == null || _reasonController.text.trim().length < FieldLimits.specialistReasonMin) return;

    final auth = context.read<AuthProvider>();
    final uid = auth.firebaseUser?.uid;
    if (uid == null) return;

    setState(() {
      _submitting = true;
      _error = null;
    });

    try {
      final requestId = await _service.createRequest(
        patientId: uid,
        specialistType: _selectedType!,
        reason: _reasonController.text.trim(),
        notes: _notesController.text.trim().isNotEmpty
            ? _notesController.text.trim()
            : null,
      );

      final label = getSpecialistLabel(_selectedType!);
      final patientName = auth.userProfile?.fullName ?? 'Patient';

      // Notify admins (non-blocking)
      NotificationHelper.notifyAdmins(
        type: 'specialist_request',
        title: 'Specialist Referral Request',
        message: '$patientName requested a $label appointment — ${_reasonController.text.trim()}',
        patientId: uid,
        extraMeta: {
          'requestId': requestId,
          'specialistType': _selectedType!,
        },
      );

      if (mounted) {
        Navigator.pop(context);
        widget.onRequested?.call();
      }
    } catch (e) {
      setState(() {
        _error = 'Failed to submit request';
        _submitting = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;

    return Container(
      padding: EdgeInsets.only(bottom: bottomInset),
      constraints: BoxConstraints(
        maxHeight: MediaQuery.of(context).size.height * 0.75,
      ),
      decoration: BoxDecoration(
        color: AppColors.surfaceCard,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
      ),
      child: SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            BottomSheetHeader(
              icon: Icons.medical_services_outlined,
              color: Colors.purple,
              title: 'Request Specialist',
            ),

            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Error
                    if (_error != null) ...[
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: Colors.red.shade50,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(_error!,
                            style: TextStyle(
                                color: Colors.red.shade700, fontSize: 14)),
                      ),
                      const SizedBox(height: 16),
                    ],

                    // Specialist type dropdown
                    Text('Specialist Type',
                        style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w500,
                            color: AppColors.textMedium)),
                    const SizedBox(height: 8),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      decoration: BoxDecoration(
                        border: Border.all(color: Colors.grey.shade300),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: DropdownButtonHideUnderline(
                        child: DropdownButton<String>(
                          value: _selectedType,
                          hint: const Text('Select a specialist...'),
                          isExpanded: true,
                          items: specialistTypes.map((entry) {
                            return DropdownMenuItem<String>(
                              value: entry.key,
                              child: Text(entry.value),
                            );
                          }).toList(),
                          onChanged: (value) =>
                              setState(() => _selectedType = value),
                        ),
                      ),
                    ),
                    const SizedBox(height: 20),

                    // Reason
                    Text('Reason for Referral *',
                        style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w500,
                            color: AppColors.textMedium)),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _reasonController,
                      maxLines: 3,
                      maxLength: FieldLimits.specialistReasonMax,
                      onChanged: (_) => setState(() {}),
                      decoration: InputDecoration(
                        hintText:
                            'Why do you need to see this specialist?',
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(10),
                          borderSide: BorderSide(color: Colors.grey.shade300),
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(10),
                          borderSide: BorderSide(color: Colors.grey.shade300),
                        ),
                        contentPadding: const EdgeInsets.all(14),
                      ),
                    ),
                    const SizedBox(height: 20),

                    // Notes
                    Text('Additional Notes (optional)',
                        style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w500,
                            color: AppColors.textMedium)),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _notesController,
                      maxLines: 3,
                      maxLength: FieldLimits.notesMax,
                      decoration: InputDecoration(
                        hintText:
                            'Any details about why you need this referral...',
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(10),
                          borderSide: BorderSide(color: Colors.grey.shade300),
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(10),
                          borderSide: BorderSide(color: Colors.grey.shade300),
                        ),
                        contentPadding: const EdgeInsets.all(14),
                      ),
                    ),
                    const SizedBox(height: 24),

                    // Submit
                    SizedBox(
                      width: double.infinity,
                      child: ElevatedButton(
                        onPressed:
                            _selectedType != null && !_submitting && _reasonController.text.trim().length >= FieldLimits.specialistReasonMin
                                ? _submit
                                : null,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.purple,
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(10),
                          ),
                        ),
                        child: _submitting
                            ? const SizedBox(
                                width: 20,
                                height: 20,
                                child: CircularProgressIndicator(
                                    strokeWidth: 2, color: Colors.white),
                              )
                            : const Text('Submit Request',
                                style: TextStyle(
                                    fontSize: 16, fontWeight: FontWeight.w600)),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
