import 'package:flutter/material.dart';
import '../../config/colors.dart';
import '../../models/intake_form.dart';
import '../../widgets/insurance_dropdown.dart';
import '../../widgets/pharmacy_dropdown.dart';
import '../../widgets/place_autocomplete_field.dart';

class PatientInfoSection extends StatefulWidget {
  final PatientInfoForm? initialData;
  final void Function(Map<String, dynamic> data) onComplete;

  const PatientInfoSection({
    super.key,
    this.initialData,
    required this.onComplete,
  });

  @override
  State<PatientInfoSection> createState() => _PatientInfoSectionState();
}

class _PatientInfoSectionState extends State<PatientInfoSection> {
  final _formKey = GlobalKey<FormState>();

  // Patient info
  final _fullNameCtrl = TextEditingController();
  final _dobCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  String _gender = 'male';
  final _emailCtrl = TextEditingController();
  final _addressCtrl = TextEditingController();

  // Emergency contact
  final _ecNameCtrl = TextEditingController();
  final _ecRelCtrl = TextEditingController();
  final _ecPhoneCtrl = TextEditingController();

  // Insurance
  final _insuranceProviderCtrl = TextEditingController();
  final _policyNumberCtrl = TextEditingController();
  final _groupNumberCtrl = TextEditingController();

  // Pharmacy
  final _pharmacyNameCtrl = TextEditingController();
  final _pharmacyPhoneCtrl = TextEditingController();
  final _pharmacyAddressCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    final d = widget.initialData;
    if (d != null) {
      _fullNameCtrl.text = d.fullName;
      _dobCtrl.text = d.dateOfBirth;
      _phoneCtrl.text = d.phoneNumber;
      _gender = d.gender;
      _emailCtrl.text = d.emailAddress;
      _addressCtrl.text = d.address;
      _ecNameCtrl.text = d.emergencyContactName;
      _ecRelCtrl.text = d.emergencyContactRelationship;
      _ecPhoneCtrl.text = d.emergencyContactPhone;
      _insuranceProviderCtrl.text = d.insuranceProvider ?? '';
      _policyNumberCtrl.text = d.policyNumber ?? '';
      _groupNumberCtrl.text = d.groupNumber ?? '';
      _pharmacyNameCtrl.text = d.pharmacyName ?? '';
      _pharmacyPhoneCtrl.text = d.pharmacyPhone ?? '';
      _pharmacyAddressCtrl.text = d.pharmacyAddress ?? '';
    }
  }

  @override
  void dispose() {
    _fullNameCtrl.dispose();
    _dobCtrl.dispose();
    _phoneCtrl.dispose();
    _emailCtrl.dispose();
    _addressCtrl.dispose();
    _ecNameCtrl.dispose();
    _ecRelCtrl.dispose();
    _ecPhoneCtrl.dispose();
    _insuranceProviderCtrl.dispose();
    _policyNumberCtrl.dispose();
    _groupNumberCtrl.dispose();
    _pharmacyNameCtrl.dispose();
    _pharmacyPhoneCtrl.dispose();
    _pharmacyAddressCtrl.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime(1990),
      firstDate: DateTime(1900),
      lastDate: DateTime.now(),
    );
    if (picked != null) {
      setState(() {
        _dobCtrl.text =
            '${picked.year}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
      });
    }
  }

  void _submit() {
    if (!_formKey.currentState!.validate()) return;

    final data = PatientInfoForm(
      fullName: _fullNameCtrl.text.trim(),
      dateOfBirth: _dobCtrl.text.trim(),
      phoneNumber: _phoneCtrl.text.trim(),
      gender: _gender,
      emailAddress: _emailCtrl.text.trim(),
      address: _addressCtrl.text.trim(),
      emergencyContactName: _ecNameCtrl.text.trim(),
      emergencyContactRelationship: _ecRelCtrl.text.trim(),
      emergencyContactPhone: _ecPhoneCtrl.text.trim(),
      insuranceProvider: _insuranceProviderCtrl.text.trim().isNotEmpty
          ? _insuranceProviderCtrl.text.trim()
          : null,
      policyNumber: _policyNumberCtrl.text.trim().isNotEmpty
          ? _policyNumberCtrl.text.trim()
          : null,
      groupNumber: _groupNumberCtrl.text.trim().isNotEmpty
          ? _groupNumberCtrl.text.trim()
          : null,
      pharmacyName: _pharmacyNameCtrl.text.trim().isNotEmpty
          ? _pharmacyNameCtrl.text.trim()
          : null,
      pharmacyPhone: _pharmacyPhoneCtrl.text.trim().isNotEmpty
          ? _pharmacyPhoneCtrl.text.trim()
          : null,
      pharmacyAddress: _pharmacyAddressCtrl.text.trim().isNotEmpty
          ? _pharmacyAddressCtrl.text.trim()
          : null,
    ).toMap();
    widget.onComplete(data);
  }

  @override
  Widget build(BuildContext context) {
    return Form(
      key: _formKey,
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _sectionTitle('Personal Details'),
            _buildTextField(_fullNameCtrl, 'Full Name', required: true),
            const SizedBox(height: 10),
            GestureDetector(
              onTap: _pickDate,
              child: AbsorbPointer(
                child: _buildTextField(_dobCtrl, 'Date of Birth',
                    required: true),
              ),
            ),
            const SizedBox(height: 10),
            _buildTextField(_phoneCtrl, 'Phone Number',
                keyboard: TextInputType.phone, required: true),
            const SizedBox(height: 10),

            // Gender radio
            Text('Gender *',
                style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                    color: AppColors.textMedium)),
            const SizedBox(height: 6),
            Row(
              children: [
                _genderRadio('Male', 'male'),
                const SizedBox(width: 24),
                _genderRadio('Female', 'female'),
              ],
            ),
            const SizedBox(height: 10),

            _buildTextField(_emailCtrl, 'Email Address',
                keyboard: TextInputType.emailAddress, required: true),
            const SizedBox(height: 10),

            // Patient address with Google Places autocomplete
            PlaceAutocompleteField(
              controller: _addressCtrl,
              label: 'Address *',
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'Required' : null,
            ),

            const SizedBox(height: 24),
            _sectionTitle('Emergency Contact'),
            _buildTextField(_ecNameCtrl, 'Name', required: true),
            const SizedBox(height: 10),
            _buildTextField(_ecRelCtrl, 'Relationship', required: true),
            const SizedBox(height: 10),
            _buildTextField(_ecPhoneCtrl, 'Phone Number',
                keyboard: TextInputType.phone, required: true),

            const SizedBox(height: 24),
            _sectionTitle('Insurance Information'),
            InsuranceDropdown(controller: _insuranceProviderCtrl),
            const SizedBox(height: 10),
            _buildTextField(_policyNumberCtrl, 'Policy Number'),
            const SizedBox(height: 10),
            _buildTextField(_groupNumberCtrl, 'Group Number'),

            const SizedBox(height: 24),
            _sectionTitle('Preferred Pharmacy'),
            PharmacyDropdown(controller: _pharmacyNameCtrl),
            const SizedBox(height: 10),
            _buildTextField(_pharmacyPhoneCtrl, 'Phone Number',
                keyboard: TextInputType.phone),
            const SizedBox(height: 10),

            // Pharmacy address with Google Places autocomplete
            PlaceAutocompleteField(
              controller: _pharmacyAddressCtrl,
              label: 'Pharmacy Address',
              onPlaceSelected: (address, name, phone) {
                // Auto-fill pharmacy name and phone if returned by Places API
                if (name != null && _pharmacyNameCtrl.text.isEmpty) {
                  _pharmacyNameCtrl.text = name;
                }
                if (phone != null && _pharmacyPhoneCtrl.text.isEmpty) {
                  _pharmacyPhoneCtrl.text = phone;
                }
              },
            ),

            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _submit,
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10)),
                ),
                child: const Text('Complete Patient Information',
                    style: TextStyle(fontWeight: FontWeight.w600)),
              ),
            ),
            const SizedBox(height: 16),
          ],
        ),
      ),
    );
  }

  Widget _genderRadio(String label, String value) {
    return GestureDetector(
      onTap: () => setState(() => _gender = value),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Radio<String>(
            value: value,
            groupValue: _gender,
            onChanged: (v) => setState(() => _gender = v!),
            activeColor: AppColors.primary,
          ),
          Text(label,
              style: TextStyle(fontSize: 14, color: AppColors.textDark)),
        ],
      ),
    );
  }

  Widget _sectionTitle(String title) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Text(title,
          style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w600,
              color: AppColors.textDark)),
    );
  }

  Widget _buildTextField(TextEditingController ctrl, String label,
      {TextInputType? keyboard, bool required = false}) {
    return TextFormField(
      controller: ctrl,
      keyboardType: keyboard,
      validator: required
          ? (v) => (v == null || v.trim().isEmpty) ? 'Required' : null
          : null,
      decoration: InputDecoration(
        labelText: label,
        isDense: true,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
      ),
    );
  }
}
