import 'package:flutter/material.dart';
import '../config/colors.dart';

const List<String> popularPharmacies = [
  'Acme Markets Pharmacy',
  'Albertsons Pharmacy',
  'Amigos Pharmacy',
  'Carrs Pharmacy',
  'City Market Pharmacy',
  'Costco Pharmacy',
  'CVS Pharmacy',
  'Dillons Pharmacy',
  'Food 4 Less Pharmacy',
  'Fred Meyer Pharmacy',
  'Fry\'s Pharmacy',
  'Gerbes Pharmacy',
  'Giant Eagle Pharmacy',
  'Harris Teeter Pharmacy',
  'H-E-B Pharmacy',
  'Jay C Food Store Pharmacy',
  'Jewel-Osco Pharmacy',
  'King Soopers Pharmacy',
  'Kroger Pharmacy',
  'Market Street Pharmacy',
  'Meijer Pharmacy',
  'Owen\'s Pharmacy',
  'Pavilions Pharmacy',
  'Pay Less Pharmacy',
  'Publix Pharmacy',
  'QFC Pharmacy',
  'Ralphs Pharmacy',
  'Randalls Pharmacy',
  'Rite Aid',
  'Safeway Pharmacy',
  'Sam\'s Club Pharmacy',
  'Scott\'s Pharmacy',
  'Shaw\'s Pharmacy',
  'ShopRite Pharmacy',
  'Smith\'s Pharmacy',
  'Star Market Pharmacy',
  'Stop & Shop Pharmacy',
  'Target Pharmacy',
  'Thriftway Pharmacy',
  'Tom Thumb Pharmacy',
  'United Supermarkets Pharmacy',
  'Vons Pharmacy',
  'Walgreens',
  'Walmart Pharmacy',
  'Wegmans Pharmacy',
];

/// Searchable pharmacy name field with popular pharmacy suggestions.
/// Shows a dropdown of matching pharmacies as the user types,
/// plus an option to use a custom name.
class PharmacyDropdown extends StatefulWidget {
  final TextEditingController controller;
  final String? Function(String?)? validator;

  const PharmacyDropdown({super.key, required this.controller, this.validator});

  @override
  State<PharmacyDropdown> createState() => _PharmacyDropdownState();
}

class _PharmacyDropdownState extends State<PharmacyDropdown> {
  List<String> _filtered = [];
  bool _showSuggestions = false;
  final _focusNode = FocusNode();

  @override
  void initState() {
    super.initState();
    _focusNode.addListener(() {
      if (_focusNode.hasFocus && widget.controller.text.isEmpty) {
        setState(() {
          _filtered = popularPharmacies;
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
        _filtered = popularPharmacies;
        _showSuggestions = true;
      });
      return;
    }
    final query = value.toLowerCase();
    setState(() {
      _filtered = popularPharmacies
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
            labelText: 'Pharmacy Name',
            counterText: '',
            isDense: true,
            prefixIcon: const Icon(Icons.local_pharmacy, size: 20),
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
                  leading: Icon(Icons.local_pharmacy,
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
