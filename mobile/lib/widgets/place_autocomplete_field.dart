import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../config/constants.dart';
import '../config/colors.dart';

/// A text field with Google Places autocomplete suggestions.
/// Uses an Overlay to show suggestions above the keyboard.
/// Scrolls itself into view when focused.
class PlaceAutocompleteField extends StatefulWidget {
  final TextEditingController controller;
  final String label;
  final String? Function(String?)? validator;
  final void Function(String address, String? name, String? phone)? onPlaceSelected;

  const PlaceAutocompleteField({
    super.key,
    required this.controller,
    this.label = 'Address',
    this.validator,
    this.onPlaceSelected,
  });

  @override
  State<PlaceAutocompleteField> createState() => _PlaceAutocompleteFieldState();
}

class _PlaceAutocompleteFieldState extends State<PlaceAutocompleteField> {
  List<_PlacePrediction> _predictions = [];
  Timer? _debounce;
  final _focusNode = FocusNode();
  final _fieldKey = GlobalKey();
  final _layerLink = LayerLink();
  OverlayEntry? _overlayEntry;

  @override
  void initState() {
    super.initState();
    _focusNode.addListener(_onFocusChange);
  }

  @override
  void dispose() {
    _removeOverlay();
    _debounce?.cancel();
    _focusNode.removeListener(_onFocusChange);
    _focusNode.dispose();
    super.dispose();
  }

  void _onFocusChange() {
    if (_focusNode.hasFocus) {
      // Scroll this field toward the top to make room for autocomplete dropdown
      WidgetsBinding.instance.addPostFrameCallback((_) {
        final ctx = _fieldKey.currentContext;
        if (ctx != null) {
          Scrollable.ensureVisible(ctx,
              duration: const Duration(milliseconds: 300),
              alignment: 0.0); // 0.0 = align to top of scroll viewport
        }
      });
    } else {
      // Delay to allow tap on suggestion
      Future.delayed(const Duration(milliseconds: 250), () {
        _removeOverlay();
      });
    }
  }

  void _onChanged(String value) {
    _debounce?.cancel();
    if (value.length < 3) {
      _removeOverlay();
      _predictions = [];
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 400), () {
      _fetchPredictions(value);
    });
  }

  Future<void> _fetchPredictions(String input) async {
    try {
      final url = Uri.parse(
        'https://maps.googleapis.com/maps/api/place/autocomplete/json'
        '?input=${Uri.encodeComponent(input)}'
        '&components=country:us'
        '&key=$googleMapsApiKey',
      );
      final response = await http.get(url);
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        if (data['status'] != 'OK' && data['status'] != 'ZERO_RESULTS') {
          return;
        }
        final predictions = (data['predictions'] as List)
            .map((p) => _PlacePrediction(
                  placeId: p['place_id'],
                  description: p['description'],
                  mainText: p['structured_formatting']?['main_text'] ?? '',
                ))
            .toList();
        if (mounted) {
          _predictions = predictions;
          if (predictions.isNotEmpty) {
            _showOverlay();
          } else {
            _removeOverlay();
          }
        }
      }
    } catch (e) {
      debugPrint('[PlacesAPI] Error: $e');
    }
  }

  void _showOverlay() {
    _removeOverlay();

    final renderBox = _fieldKey.currentContext?.findRenderObject() as RenderBox?;
    if (renderBox == null) return;
    final fieldWidth = renderBox.size.width;

    _overlayEntry = OverlayEntry(
      builder: (context) => Positioned(
        width: fieldWidth,
        child: CompositedTransformFollower(
          link: _layerLink,
          showWhenUnlinked: false,
          offset: Offset(0, renderBox.size.height + 4),
          child: Material(
            elevation: 4,
            borderRadius: BorderRadius.circular(10),
            child: Container(
              constraints: const BoxConstraints(maxHeight: 200),
              decoration: BoxDecoration(
                color: AppColors.surfaceCard,
                borderRadius: BorderRadius.circular(10),
              ),
              child: ListView.separated(
                shrinkWrap: true,
                padding: EdgeInsets.zero,
                itemCount: _predictions.length,
                separatorBuilder: (_, __) =>
                    Divider(height: 1, color: Colors.grey.shade200),
                itemBuilder: (context, index) {
                  final p = _predictions[index];
                  return ListTile(
                    dense: true,
                    leading: Icon(Icons.location_on_outlined,
                        size: 18, color: AppColors.primary),
                    title: Text(p.mainText,
                        style: const TextStyle(
                            fontSize: 14, fontWeight: FontWeight.w500)),
                    subtitle: Text(p.description,
                        style: TextStyle(
                            fontSize: 12, color: Colors.grey.shade600),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis),
                    onTap: () => _selectPlace(p),
                  );
                },
              ),
            ),
          ),
        ),
      ),
    );

    Overlay.of(context).insert(_overlayEntry!);
  }

  void _removeOverlay() {
    _overlayEntry?.remove();
    _overlayEntry = null;
  }

  Future<void> _selectPlace(_PlacePrediction prediction) async {
    _removeOverlay();
    _focusNode.unfocus();

    try {
      final url = Uri.parse(
        'https://maps.googleapis.com/maps/api/place/details/json'
        '?place_id=${prediction.placeId}'
        '&fields=formatted_address,name,formatted_phone_number'
        '&key=$googleMapsApiKey',
      );
      final response = await http.get(url);
      if (response.statusCode == 200) {
        final result = json.decode(response.body)['result'];
        final address = result['formatted_address'] ?? prediction.description;
        final name = result['name'];
        final phone = result['formatted_phone_number'];

        widget.controller.text = address;
        widget.onPlaceSelected?.call(address, name, phone);
      } else {
        widget.controller.text = prediction.description;
        widget.onPlaceSelected?.call(prediction.description, prediction.mainText, null);
      }
    } catch (_) {
      widget.controller.text = prediction.description;
      widget.onPlaceSelected?.call(prediction.description, prediction.mainText, null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return CompositedTransformTarget(
      link: _layerLink,
      child: TextField(
        key: _fieldKey,
        controller: widget.controller,
        focusNode: _focusNode,
        textCapitalization: TextCapitalization.words,
        onChanged: _onChanged,
        decoration: InputDecoration(
          labelText: widget.label,
          counterText: '',
          isDense: true,
          prefixIcon: const Icon(Icons.search, size: 20),
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
        ),
      ),
    );
  }
}

class _PlacePrediction {
  final String placeId;
  final String description;
  final String mainText;

  _PlacePrediction({
    required this.placeId,
    required this.description,
    required this.mainText,
  });
}
