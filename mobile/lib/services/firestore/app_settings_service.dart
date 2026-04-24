import 'package:cloud_firestore/cloud_firestore.dart';

/// Mirror of the patient-relevant fields in `system/settings`.
///
/// The web app owns the write path (admin-only). Mobile is read-only.
/// Defaults mirror `APP_SETTINGS_DEFAULTS` in `web/src/lib/firestore/app-settings.ts`.
class AppSettings {
  final bool registrationEnabled;
  final bool simulationMode;
  final String? supportEmail;

  const AppSettings({
    required this.registrationEnabled,
    required this.simulationMode,
    this.supportEmail,
  });

  static const defaults = AppSettings(
    registrationEnabled: false,
    simulationMode: false,
    supportEmail: null,
  );

  factory AppSettings.fromMap(Map<String, dynamic>? data) {
    if (data == null) return defaults;
    final email = data['supportEmail'];
    return AppSettings(
      registrationEnabled: data['registrationEnabled'] is bool
          ? data['registrationEnabled'] as bool
          : defaults.registrationEnabled,
      simulationMode: data['simulationMode'] is bool
          ? data['simulationMode'] as bool
          : defaults.simulationMode,
      supportEmail: email is String && email.trim().isNotEmpty
          ? email.trim()
          : null,
    );
  }
}

class AppSettingsService {
  static final _firestore = FirebaseFirestore.instance;
  static final _doc = _firestore.collection('system').doc('settings');

  /// Live stream of app settings. Falls back to defaults on missing doc
  /// or read errors so the UI never blocks.
  static Stream<AppSettings> watch() {
    return _doc.snapshots().map(
      (snap) => snap.exists ? AppSettings.fromMap(snap.data()) : AppSettings.defaults,
    ).handleError((_) => AppSettings.defaults);
  }

  /// One-shot read.
  static Future<AppSettings> get() async {
    try {
      final snap = await _doc.get();
      return snap.exists ? AppSettings.fromMap(snap.data()) : AppSettings.defaults;
    } catch (_) {
      return AppSettings.defaults;
    }
  }
}
