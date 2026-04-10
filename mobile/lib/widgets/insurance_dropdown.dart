import 'package:flutter/material.dart';
import '../config/colors.dart';

const List<String> usInsuranceProviders = [
  'Aetna',
  'Ambetter',
  'Anthem Blue Cross Blue Shield',
  'Blue Cross Blue Shield',
  'CareSource',
  'Centene',
  'Cigna',
  'Devoted Health',
  'Florida Blue',
  'Health Net',
  'Highmark',
  'Humana',
  'Independence Blue Cross',
  'Kaiser Permanente',
  'Medicaid',
  'Medicare',
  'Molina Healthcare',
  'Oscar Health',
  'Oxford Health Plans',
  'TRICARE',
  'UnitedHealthcare',
  'WellCare',
];

/// Searchable insurance provider field with common US provider suggestions.
/// Shows a dropdown of matching providers as the user types,
/// plus the ability to type a custom name.
class InsuranceDropdown extends StatefulWidget {
  final TextEditingController controller;
  final String? Function(String?)? validator;

  const InsuranceDropdown({super.key, required this.controller, this.validator});

  @override
  State<InsuranceDropdown> createState() => _InsuranceDropdownState();
}

class _InsuranceDropdownState extends State<InsuranceDropdown> {
  List<String> _filtered = [];
  bool _showSuggestions = false;
  final _focusNode = FocusNode();

  @override
  void initState() {
    super.initState();
    _focusNode.addListener(() {
      if (_focusNode.hasFocus && widget.controller.text.isEmpty) {
        setState(() {
          _filtered = usInsuranceProviders;
          _showSuggestions = true;
        });
      }
      if (!_focusNode.hasFocus) {
        Future.delayed(const Duration(milliseconds: 200), () {
          if (mounted) setState(() => _showSuggestions = false);
        });
      }
    });
  }

  @override
  void dispose() {
    _focusNode.dispose();
    super.dispose();
  }

  void _onChanged(String value) {
    if (value.isEmpty) {
      setState(() {
        _filtered = usInsuranceProviders;
        _showSuggestions = true;
      });
      return;
    }
    final query = value.toLowerCase();
    setState(() {
      _filtered = usInsuranceProviders
          .where((p) => p.toLowerCase().contains(query))
          .toList();
      _showSuggestions = _filtered.isNotEmpty;
    });
  }

  void _select(String name) {
    widget.controller.text = name;
    setState(() => _showSuggestions = false);
    _focusNode.unfocus();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextField(
          controller: widget.controller,
          focusNode: _focusNode,
          textCapitalization: TextCapitalization.words,
          onChanged: _onChanged,
          decoration: InputDecoration(
            labelText: 'Insurance Provider',
            counterText: '',
            isDense: true,
            prefixIcon: const Icon(Icons.health_and_safety_outlined, size: 20),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
          ),
        ),
        if (_showSuggestions && _filtered.isNotEmpty)
          Container(
            constraints: const BoxConstraints(maxHeight: 200),
            margin: const EdgeInsets.only(top: 4),
            decoration: BoxDecoration(
              color: AppColors.surfaceCard,
              borderRadius: BorderRadius.circular(10),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.1),
                  blurRadius: 8,
                  offset: const Offset(0, 2),
                ),
              ],
            ),
            child: ListView.separated(
              shrinkWrap: true,
              padding: EdgeInsets.zero,
              itemCount: _filtered.length,
              separatorBuilder: (_, __) =>
                  Divider(height: 1, color: Colors.grey.shade200),
              itemBuilder: (context, index) {
                return ListTile(
                  dense: true,
                  title: Text(_filtered[index],
                      style: const TextStyle(fontSize: 14)),
                  leading: Icon(Icons.health_and_safety_outlined,
                      size: 16, color: AppColors.primary),
                  onTap: () => _select(_filtered[index]),
                );
              },
            ),
          ),
      ],
    );
  }
}
