import 'dart:async';
import 'package:flutter/foundation.dart';
import '../services/firestore/app_settings_service.dart';

/// Exposes `system/settings` to the UI. Publicly readable, so this can be
/// subscribed to before the user signs in — the auth screen uses it to hide
/// the sign-up path when `registrationEnabled` is off.
class AppSettingsProvider extends ChangeNotifier {
  AppSettings _settings = AppSettings.defaults;
  bool _loaded = false;
  StreamSubscription<AppSettings>? _subscription;

  AppSettingsProvider() {
    _subscription = AppSettingsService.watch().listen((settings) {
      _settings = settings;
      _loaded = true;
      notifyListeners();
    });
  }

  AppSettings get settings => _settings;
  bool get loaded => _loaded;
  bool get registrationEnabled => _settings.registrationEnabled;
  bool get simulationMode => _settings.simulationMode;
  String? get supportEmail => _settings.supportEmail;

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }
}
