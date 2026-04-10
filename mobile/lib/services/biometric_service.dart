import 'package:local_auth/local_auth.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../config/branding.dart';

class BiometricService {
  static const _enabledKey = 'biometric_enabled';
  static const _hasLoggedInKey = 'has_logged_in';

  final LocalAuthentication _auth = LocalAuthentication();

  /// Check if device supports biometrics
  Future<bool> isAvailable() async {
    try {
      final canCheck = await _auth.canCheckBiometrics;
      final isSupported = await _auth.isDeviceSupported();
      return canCheck && isSupported;
    } catch (_) {
      return false;
    }
  }

  /// Check if biometric login is enabled (defaults to true)
  Future<bool> isEnabled() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_enabledKey) ?? true;
  }

  /// Set biometric login enabled/disabled
  Future<void> setEnabled(bool enabled) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_enabledKey, enabled);
  }

  /// Check if user has logged in before (skip biometric on first login)
  Future<bool> hasLoggedInBefore() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_hasLoggedInKey) ?? false;
  }

  /// Mark that user has logged in
  Future<void> markLoggedIn() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_hasLoggedInKey, true);
  }

  /// Clear stored state (on sign out) — keeps enabled preference
  Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_hasLoggedInKey);
    // Note: _enabledKey is intentionally kept so biometric stays enabled
  }

  /// Prompt biometric authentication
  Future<bool> authenticate() async {
    try {
      return await _auth.authenticate(
        localizedReason: 'Verify your identity to access ${branding.shortName}',
        biometricOnly: true,
        sensitiveTransaction: true,
        persistAcrossBackgrounding: true,
      );
    } catch (e) {
      // Log error for debugging — don't silently swallow
      // ignore: avoid_print
      print('[Biometric] authenticate error: $e');
      return false;
    }
  }
}
