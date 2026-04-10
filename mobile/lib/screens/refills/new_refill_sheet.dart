import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../providers/auth_provider.dart';
import '../../services/firestore/refills_service.dart';
import '../../services/firestore/notification_helper.dart';
import '../../models/refill.dart';
import '../../config/constants.dart';
import '../../config/colors.dart';
import '../../widgets/bottom_sheet_header.dart';
import '../../widgets/place_autocomplete_field.dart';
import '../../widgets/pharmacy_dropdown.dart';

class NewRefillSheet extends StatefulWidget {
  final VoidCallback? onCreated;
  final PrescriptionRefill? editing;

  const NewRefillSheet({super.key, this.onCreated, this.editing});

  static Future<void> show(BuildContext context,
      {VoidCallback? onCreated, PrescriptionRefill? editing}) {
    return showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) =>
          NewRefillSheet(onCreated: onCreated, editing: editing),
    );
  }

  @override
  State<NewRefillSheet> createState() => _NewRefillSheetState();
}

class _NewRefillSheetState extends State<NewRefillSheet> {
  final _medicationController = TextEditingController();
  final _dosageController = TextEditingController();
  final _quantityController = TextEditingController();
  final _pharmacyNameController = TextEditingController();
  final _pharmacyPhoneController = TextEditingController();
  final _pharmacyAddressController = TextEditingController();
  final _notesController = TextEditingController();
  final _service = RefillsService();

  String _urgency = 'routine';
  bool _submitting = false;
  String? _error;

  bool get _isEditing => widget.editing != null;

  @override
  void initState() {
    super.initState();
    if (widget.editing != null) {
      final r = widget.editing!;
      _medicationController.text = r.medicationName;
      _dosageController.text = r.dosage ?? '';
      _quantityController.text = r.quantity ?? '';
      _pharmacyNameController.text = r.pharmacyName ?? '';
      _pharmacyPhoneController.text = r.pharmacyPhone ?? '';
      _pharmacyAddressController.text = r.pharmacyAddress ?? '';
      _notesController.text = r.notes ?? '';
      _urgency = r.urgency.name;
    }
  }

  @override
  void dispose() {
    _medicationController.dispose();
    _dosageController.dispose();
    _quantityController.dispose();
    _pharmacyNameController.dispose();
    _pharmacyPhoneController.dispose();
    _pharmacyAddressController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  String? _validate() {
    if (_medicationController.text.trim().length < FieldLimits.medicationNameMin) {
      return 'Medication name is required';
    }
    if (_dosageController.text.trim().isEmpty) {
      return 'Dosage is required';
    }
    if (_quantityController.text.trim().isEmpty) {
      return 'Quantity is required';
    }
    if (_pharmacyNameController.text.trim().isEmpty) {
      return 'Pharmacy name is required';
    }
    return null;
  }

  Future<void> _submit() async {
    final validationError = _validate();
    if (validationError != null) {
      setState(() => _error = validationError);
      return;
    }

    final auth = context.read<AuthProvider>();
    final uid = auth.firebaseUser?.uid;
    final patientName = auth.userProfile?.fullName ?? 'Patient';
    if (uid == null) return;

    setState(() {
      _submitting = true;
      _error = null;
    });

    try {
      final data = <String, dynamic>{
        'medicationName': _medicationController.text.trim(),
        'dosage': _dosageController.text.trim(),
        'quantity': _quantityController.text.trim(),
        'pharmacyName': _pharmacyNameController.text.trim(),
        'pharmacyPhone': _pharmacyPhoneController.text.trim().isNotEmpty
            ? _pharmacyPhoneController.text.trim()
            : null,
        'pharmacyAddress': _pharmacyAddressController.text.trim().isNotEmpty
            ? _pharmacyAddressController.text.trim()
            : null,
        'urgency': _urgency,
        'notes': _notesController.text.trim().isNotEmpty
            ? _notesController.text.trim()
            : null,
      };

      if (_isEditing) {
        await _service.updateRefill(widget.editing!.id, data);
      } else {
        await _service.createRefillRequest(
          patientId: uid,
          medicationName: data['medicationName']!,
          dosage: data['dosage'],
          quantity: data['quantity'],
          pharmacyName: data['pharmacyName'],
          pharmacyPhone: data['pharmacyPhone'],
          pharmacyAddress: data['pharmacyAddress'],
          urgency: _urgency,
          notes: data['notes'],
        );

        // Notify admins
        await NotificationHelper.notifyAdmins(
          type: 'refill_request',
          title: 'New Refill Request',
          message: '$patientName — ${data['medicationName']} ($_urgency)',
          patientId: uid,
        );
      }

      if (mounted) {
        Navigator.pop(context);
        widget.onCreated?.call();
      }
    } catch (e) {
      setState(() {
        _error = _isEditing
            ? 'Failed to update. Please try again.'
            : 'Failed to submit. Please try again.';
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
        maxHeight: MediaQuery.of(context).size.height * 0.9,
      ),
      decoration: BoxDecoration(
        color: AppColors.surfaceCard,
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      child: SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            BottomSheetHeader(
              icon: Icons.medication_outlined,
              color: AppColors.warning,
              title: _isEditing ? 'Edit Refill' : 'Request Refill',
            ),

            // Scrollable content — extra bottom padding so lower fields can scroll to top
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 250),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
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

                    // -- Medication Info --
                    _sectionLabel('Medication'),
                    const SizedBox(height: 8),
                    TextField(
                      controller: _medicationController,
                      maxLength: FieldLimits.medicationNameMax,
                      textCapitalization: TextCapitalization.words,
                      decoration: _inputDecoration('Medication Name'),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _dosageController,
                            maxLength: FieldLimits.dosageMax,
                            decoration: _inputDecoration('Dosage'),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: TextField(
                            controller: _quantityController,
                            maxLength: FieldLimits.quantityMax,
                            decoration: _inputDecoration('Quantity'),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 20),

                    // -- Pharmacy Info --
                    _sectionLabel('Pharmacy'),
                    const SizedBox(height: 8),
                    PharmacyDropdown(
                      controller: _pharmacyNameController,
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _pharmacyPhoneController,
                      keyboardType: TextInputType.phone,
                      decoration: _inputDecoration('Pharmacy Phone (optional)'),
                    ),
                    const SizedBox(height: 12),
                    PlaceAutocompleteField(
                      controller: _pharmacyAddressController,
                      label: 'Search Pharmacy by Location',
                      onPlaceSelected: (address, name, phone) {
                        setState(() {
                          if (name != null && _pharmacyNameController.text.isEmpty) {
                            _pharmacyNameController.text = name;
                          }
                          if (phone != null && _pharmacyPhoneController.text.isEmpty) {
                            _pharmacyPhoneController.text = phone;
                          }
                        });
                      },
                    ),
                    const SizedBox(height: 20),

                    // -- Urgency --
                    _sectionLabel('Urgency'),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      children: {
                        'routine': 'Routine (7+ days)',
                        'urgent': 'Urgent (2-6 days)',
                        'emergency': 'Emergency (24h)',
                      }.entries.map((e) {
                        final selected = _urgency == e.key;
                        return ChoiceChip(
                          label: Text(e.value,
                              style: TextStyle(fontSize: 13)),
                          selected: selected,
                          selectedColor: e.key == 'emergency'
                              ? Colors.red.shade100
                              : e.key == 'urgent'
                                  ? Colors.orange.shade100
                                  : AppColors.primary
                                      .withValues(alpha: 0.15),
                          onSelected: (_) =>
                              setState(() => _urgency = e.key),
                        );
                      }).toList(),
                    ),
                    const SizedBox(height: 16),

                    // -- Notes --
                    TextField(
                      controller: _notesController,
                      maxLength: FieldLimits.notesMax,
                      maxLines: 3,
                      minLines: 2,
                      textCapitalization: TextCapitalization.sentences,
                      decoration: _inputDecoration('Notes (optional)',
                          alignTop: true),
                    ),
                    const SizedBox(height: 24),

                    // Submit
                    SizedBox(
                      width: double.infinity,
                      child: ElevatedButton(
                        onPressed: _submitting ? null : _submit,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.primary,
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
                            : Text(_isEditing ? 'Save Changes' : 'Submit Request',
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

  Widget _sectionLabel(String text) {
    return Text(text,
        style: TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: AppColors.textMedium));
  }

  InputDecoration _inputDecoration(String label, {bool alignTop = false}) {
    return InputDecoration(
      labelText: label,
      counterText: '',
      isDense: true,
      alignLabelWithHint: alignTop,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
    );
  }
}
