import 'package:flutter/material.dart';
import '../../config/colors.dart';
import '../../models/intake_form.dart';

class MedicalHistorySection extends StatefulWidget {
  final MedicalHistoryForm? initialData;
  final void Function(Map<String, dynamic> data) onComplete;

  const MedicalHistorySection({
    super.key,
    this.initialData,
    required this.onComplete,
  });

  @override
  State<MedicalHistorySection> createState() => _MedicalHistorySectionState();
}

class _MedicalHistorySectionState extends State<MedicalHistorySection> {
  // Free text fields
  final _medicalHistoryCtrl = TextEditingController();
  final _hospitalizationsCtrl = TextEditingController();
  final _surgicalHistoryCtrl = TextEditingController();
  final _medicationsCtrl = TextEditingController();

  // Allergies
  final List<_AllergyEntry> _allergies = [];

  // Social history
  String _smokingStatus = 'never';
  final _smokingDetailsCtrl = TextEditingController();
  String _alcoholConsumption = 'none';
  final _alcoholDetailsCtrl = TextEditingController();
  String _exerciseFrequency = 'none';
  final _exerciseDetailsCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    final d = widget.initialData;
    if (d != null) {
      _medicalHistoryCtrl.text = d.medicalHistory ?? '';
      _hospitalizationsCtrl.text = d.hospitalizations ?? '';
      _surgicalHistoryCtrl.text = d.pastSurgicalHistory ?? '';
      _medicationsCtrl.text = d.currentMedications ?? '';
      for (final a in d.allergies) {
        _allergies.add(_AllergyEntry(
          allergen: TextEditingController(text: a.allergen),
          reaction: TextEditingController(text: a.reaction),
        ));
      }
      _smokingStatus = d.smokingStatus;
      _smokingDetailsCtrl.text = d.smokingDetails ?? '';
      _alcoholConsumption = d.alcoholConsumption;
      _alcoholDetailsCtrl.text = d.alcoholDetails ?? '';
      _exerciseFrequency = d.exerciseFrequency;
      _exerciseDetailsCtrl.text = d.exerciseDetails ?? '';
    }
  }

  @override
  void dispose() {
    _medicalHistoryCtrl.dispose();
    _hospitalizationsCtrl.dispose();
    _surgicalHistoryCtrl.dispose();
    _medicationsCtrl.dispose();
    for (final a in _allergies) {
      a.allergen.dispose();
      a.reaction.dispose();
    }
    _smokingDetailsCtrl.dispose();
    _alcoholDetailsCtrl.dispose();
    _exerciseDetailsCtrl.dispose();
    super.dispose();
  }

  void _submit() {
    final data = MedicalHistoryForm(
      medicalHistory: _medicalHistoryCtrl.text.trim().isNotEmpty
          ? _medicalHistoryCtrl.text.trim()
          : null,
      hospitalizations: _hospitalizationsCtrl.text.trim().isNotEmpty
          ? _hospitalizationsCtrl.text.trim()
          : null,
      pastSurgicalHistory: _surgicalHistoryCtrl.text.trim().isNotEmpty
          ? _surgicalHistoryCtrl.text.trim()
          : null,
      currentMedications: _medicationsCtrl.text.trim().isNotEmpty
          ? _medicationsCtrl.text.trim()
          : null,
      allergies: _allergies
          .map((a) => Allergy(
                allergen: a.allergen.text.trim(),
                reaction: a.reaction.text.trim(),
              ))
          .where((a) => a.allergen.isNotEmpty)
          .toList(),
      smokingStatus: _smokingStatus,
      smokingDetails: _smokingDetailsCtrl.text.trim().isNotEmpty
          ? _smokingDetailsCtrl.text.trim()
          : null,
      alcoholConsumption: _alcoholConsumption,
      alcoholDetails: _alcoholDetailsCtrl.text.trim().isNotEmpty
          ? _alcoholDetailsCtrl.text.trim()
          : null,
      exerciseFrequency: _exerciseFrequency,
      exerciseDetails: _exerciseDetailsCtrl.text.trim().isNotEmpty
          ? _exerciseDetailsCtrl.text.trim()
          : null,
    ).toMap();
    widget.onComplete(data);
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Medical History
          _sectionTitle('Medical History'),
          _buildHint(
              'List any ongoing or past medical conditions, diagnoses, or chronic illnesses.'),
          TextField(
            controller: _medicalHistoryCtrl,
            maxLines: 3,
            decoration: InputDecoration(
              hintText:
                  'e.g. Hypertension, Type 2 Diabetes, Asthma...',
              border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10)),
            ),
          ),
          const SizedBox(height: 20),

          // Hospitalizations & Surgical History side by side on tablet, stacked on phone
          _sectionTitle('Hospitalizations'),
          _buildHint(
              'List any hospital stays, including reason and approximate date.'),
          TextField(
            controller: _hospitalizationsCtrl,
            maxLines: 3,
            decoration: InputDecoration(
              hintText:
                  'e.g. Appendectomy - June 2020, Pneumonia - March 2018...',
              border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10)),
            ),
          ),
          const SizedBox(height: 20),

          _sectionTitle('Past Surgical History'),
          _buildHint(
              'List any surgeries you have had, including approximate date.'),
          TextField(
            controller: _surgicalHistoryCtrl,
            maxLines: 3,
            decoration: InputDecoration(
              hintText:
                  'e.g. Knee replacement - 2019, Gallbladder removal - 2015...',
              border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10)),
            ),
          ),
          const SizedBox(height: 20),

          // Current Medications
          _sectionTitle('Current Medications'),
          _buildHint(
              'List all medications you are currently taking, including dosage and frequency.'),
          TextField(
            controller: _medicationsCtrl,
            maxLines: 3,
            decoration: InputDecoration(
              hintText:
                  'e.g. Metformin 500mg twice daily, Lisinopril 10mg daily...',
              border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10)),
            ),
          ),
          const SizedBox(height: 20),

          // Allergies
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              _sectionTitle('Allergies'),
              TextButton.icon(
                onPressed: () => setState(() => _allergies.add(_AllergyEntry(
                      allergen: TextEditingController(),
                      reaction: TextEditingController(),
                    ))),
                icon: const Icon(Icons.add, size: 18),
                label: const Text('Add'),
              ),
            ],
          ),
          if (_allergies.isEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text('No allergies added',
                  style: TextStyle(
                      color: Colors.grey.shade500,
                      fontStyle: FontStyle.italic)),
            ),
          for (int i = 0; i < _allergies.length; i++) _buildAllergyCard(i),
          const SizedBox(height: 20),

          // Social History
          _sectionTitle('Social History'),

          // Smoking
          _buildRadioRow('Smoking', _smokingStatus, {
            'never': 'Never',
            'former': 'Former',
            'current': 'Current',
          }, (v) => setState(() => _smokingStatus = v), _smokingDetailsCtrl),
          const SizedBox(height: 12),

          // Alcohol
          _buildRadioRow('Alcohol Use', _alcoholConsumption, {
            'none': 'None',
            'occasional': 'Occasional',
            'moderate': 'Moderate',
            'heavy': 'Heavy',
          }, (v) => setState(() => _alcoholConsumption = v),
              _alcoholDetailsCtrl),
          const SizedBox(height: 12),

          // Exercise
          _buildRadioRow('Exercise', _exerciseFrequency, {
            'none': 'None',
            'rarely': 'Rarely',
            'weekly': 'Weekly',
            'daily': 'Daily',
          }, (v) => setState(() => _exerciseFrequency = v),
              _exerciseDetailsCtrl),

          const SizedBox(height: 20),

          // Medical Record Submission note
          _sectionTitle('Medical Record Submission'),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.primary.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(
                  color: AppColors.primary.withValues(alpha: 0.2)),
            ),
            child: Text(
              'Please upload medical records from the past three years, including physician notes, laboratory results, imaging studies, mammograms, and records of specialist visits.\n\nYou can upload documents from the Documents screen after completing the intake form.',
              style: TextStyle(fontSize: 13, color: AppColors.textDark),
            ),
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
              child: const Text('Complete Medical History',
                  style: TextStyle(fontWeight: FontWeight.w600)),
            ),
          ),
          const SizedBox(height: 16),
        ],
      ),
    );
  }

  Widget _sectionTitle(String title) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Text(title,
          style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w600,
              color: AppColors.textDark)),
    );
  }

  Widget _buildHint(String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(text,
          style: TextStyle(fontSize: 12, color: AppColors.textMedium)),
    );
  }

  Widget _buildAllergyCard(int index) {
    final a = _allergies[index];
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surfaceCard,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.divider),
      ),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              GestureDetector(
                onTap: () => setState(() {
                  _allergies[index].dispose();
                  _allergies.removeAt(index);
                }),
                child:
                    Icon(Icons.close, size: 18, color: Colors.grey.shade500),
              ),
            ],
          ),
          TextFormField(
            controller: a.allergen,
            decoration: InputDecoration(
              labelText: 'Allergen',
              hintText: 'e.g. Penicillin',
              isDense: true,
              border:
                  OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
            ),
          ),
          const SizedBox(height: 8),
          TextFormField(
            controller: a.reaction,
            decoration: InputDecoration(
              labelText: 'Reaction',
              hintText: 'e.g. Hives, swelling',
              isDense: true,
              border:
                  OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRadioRow(
    String label,
    String currentValue,
    Map<String, String> options,
    ValueChanged<String> onChanged,
    TextEditingController detailsCtrl,
  ) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label,
            style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w500,
                color: AppColors.textMedium)),
        const SizedBox(height: 4),
        Wrap(
          spacing: 4,
          children: options.entries.map((e) {
            return GestureDetector(
              onTap: () => onChanged(e.key),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Radio<String>(
                    value: e.key,
                    groupValue: currentValue,
                    onChanged: (v) => onChanged(v!),
                    activeColor: AppColors.primary,
                    materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    visualDensity: VisualDensity.compact,
                  ),
                  Text(e.value,
                      style: TextStyle(
                          fontSize: 13, color: AppColors.textDark)),
                ],
              ),
            );
          }).toList(),
        ),
        const SizedBox(height: 6),
        TextField(
          controller: detailsCtrl,
          decoration: InputDecoration(
            hintText: 'Details...',
            isDense: true,
            border:
                OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
          ),
        ),
      ],
    );
  }
}

class _AllergyEntry {
  final TextEditingController allergen;
  final TextEditingController reaction;

  _AllergyEntry({
    required this.allergen,
    required this.reaction,
  });

  void dispose() {
    allergen.dispose();
    reaction.dispose();
  }
}
