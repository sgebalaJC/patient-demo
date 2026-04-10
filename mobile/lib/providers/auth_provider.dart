import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../models/user.dart';
import '../services/auth_service.dart';
import '../services/biometric_service.dart';

enum AuthStatus {
  uninitialized,
  authenticated,
  unauthenticated,
  adminBlocked,
  inactive,
  biometricLocked,
}

class AuthProvider extends ChangeNotifier {
  final AuthService _authService = AuthService();
  final BiometricService _biometricService = BiometricService();

  AuthStatus _status = AuthStatus.uninitialized;
  User? _firebaseUser;
  AppUser? _userProfile;
  String? _error;
  bool _loading = false;
  bool _biometricPassed = false;
  bool _biometricChecking = false;

  StreamSubscription<User?>? _authSubscription;
  StreamSubscription<AppUser?>? _profileSubscription;

  AuthStatus get status => _status;
  User? get firebaseUser => _firebaseUser;
  AppUser? get userProfile => _userProfile;
  String? get error => _error;
  bool get loading => _loading;
  bool get isAuthenticated => _status == AuthStatus.authenticated;
  BiometricService get biometricService => _biometricService;

  AuthProvider() {
    _init();
  }

  void _init() {
    _authSubscription =
        _authService.authStateChanges.listen(_onAuthStateChanged);
  }

  Future<void> _onAuthStateChanged(User? firebaseUser) async {
    _firebaseUser = firebaseUser;

    if (firebaseUser == null) {
      _userProfile = null;
      _biometricPassed = false;
      _status = AuthStatus.unauthenticated;
      _profileSubscription?.cancel();
      notifyListeners();
      return;
    }

    // Listen to profile changes in real-time
    _profileSubscription?.cancel();
    _profileSubscription =
        _authService.userProfileStream(firebaseUser.uid).listen(
      (profile) {
        _userProfile = profile;
        _resolveStatus(profile);
        notifyListeners();
      },
      onError: (error) {
        _error = 'Failed to load user profile';
        _status = AuthStatus.unauthenticated;
        notifyListeners();
      },
    );
  }

  void _resolveStatus(AppUser? profile) {
    if (profile == null) {
      _status = AuthStatus.unauthenticated;
    } else if (profile.role == UserRole.admin ||
        profile.role == UserRole.assistant) {
      _status = AuthStatus.adminBlocked;
    } else if (!profile.isActive) {
      _status = AuthStatus.inactive;
    } else if (!_biometricPassed) {
      _status = AuthStatus.biometricLocked;
      if (!_biometricChecking) {
        _checkBiometric();
      }
    } else {
      _status = AuthStatus.authenticated;
    }
  }

  Future<void> _checkBiometric() async {
    _biometricChecking = true;

    final available = await _biometricService.isAvailable();
    final enabled = await _biometricService.isEnabled();
    final hasLoggedIn = await _biometricService.hasLoggedInBefore();

    debugPrint('[Biometric] available=$available enabled=$enabled hasLoggedIn=$hasLoggedIn');

    // Skip biometric if not available or disabled
    // Note: hasLoggedIn is no longer checked — if biometric is enabled,
    // it's always required on app launch regardless of login history
    if (!available || !enabled) {
      debugPrint('[Biometric] Skipping — available=$available enabled=$enabled');
      _biometricPassed = true;
      _biometricChecking = false;
      _resolveStatus(_userProfile);
      notifyListeners();
      return;
    }

    // Prompt biometric — stay on lock screen until success
    debugPrint('[Biometric] Prompting...');
    final success = await _biometricService.authenticate();
    debugPrint('[Biometric] Result: $success');
    _biometricChecking = false;
    if (success) {
      _biometricPassed = true;
      _resolveStatus(_userProfile);
      notifyListeners();
    }
    // If failed/cancelled, stay on biometricLocked — user taps retry
  }

  /// Retry biometric authentication (called from lock screen)
  Future<void> retryBiometric() async {
    final success = await _biometricService.authenticate();
    if (success) {
      _biometricPassed = true;
      _resolveStatus(_userProfile);
      notifyListeners();
    }
  }

  Future<void> signInWithEmail(String email, String password) async {
    _setLoading(true);
    _error = null;
    try {
      await _authService.signInWithEmail(email, password);
      _biometricPassed = true; // Fresh login, no biometric needed
      await _biometricService.markLoggedIn();
    } on FirebaseAuthException catch (e) {
      _error = _mapAuthError(e.code);
    } catch (e) {
      _error = 'An unexpected error occurred';
    } finally {
      _setLoading(false);
    }
  }

  Future<void> signUpWithEmail({
    required String email,
    required String password,
    String? firstName,
    String? lastName,
    String? phoneNumber,
  }) async {
    _setLoading(true);
    _error = null;
    try {
      await _authService.signUpWithEmail(
        email: email,
        password: password,
        firstName: firstName,
        lastName: lastName,
        phoneNumber: phoneNumber,
      );
      _biometricPassed = true;
    } on FirebaseAuthException catch (e) {
      _error = _mapAuthError(e.code);
    } catch (e) {
      _error = 'An unexpected error occurred';
    } finally {
      _setLoading(false);
    }
  }

  /// Send phone login OTP
  Future<Map<String, dynamic>> sendPhoneLoginCode(String phoneNumber) async {
    _error = null;
    try {
      return await _authService.sendPhoneLoginCode(phoneNumber);
    } catch (e) {
      _error = 'Failed to send verification code';
      notifyListeners();
      return {'success': false, 'error': _error};
    }
  }

  /// Verify phone login OTP and sign in
  Future<Map<String, dynamic>> verifyPhoneLogin(
    String phoneNumber,
    String code, {
    String? firstName,
    String? lastName,
  }) async {
    _setLoading(true);
    _error = null;
    try {
      final result = await _authService.verifyPhoneLogin(
        phoneNumber,
        code,
        firstName: firstName,
        lastName: lastName,
      );
      if (result['success'] == true && result['token'] != null) {
        _biometricPassed = true;
        await _biometricService.markLoggedIn();
      }
      return result;
    } catch (e) {
      _error = 'Verification failed';
      notifyListeners();
      return {'success': false, 'error': _error};
    } finally {
      _setLoading(false);
    }
  }

  Future<void> signInWithGoogle() async {
    _setLoading(true);
    _error = null;
    try {
      await _authService.signInWithGoogle();
      _biometricPassed = true; // Fresh login, no biometric needed
      await _biometricService.markLoggedIn();
    } on FirebaseAuthException catch (e) {
      if (e.code == 'sign-in-cancelled') return;
      _error = _mapAuthError(e.code);
    } catch (e) {
      _error = 'An unexpected error occurred';
    } finally {
      _setLoading(false);
    }
  }

  Future<void> resetPassword(String email) async {
    _setLoading(true);
    _error = null;
    try {
      await _authService.resetPassword(email);
    } on FirebaseAuthException catch (e) {
      _error = _mapAuthError(e.code);
    } catch (e) {
      _error = 'An unexpected error occurred';
    } finally {
      _setLoading(false);
    }
  }

  Future<void> signOut() async {
    _biometricPassed = false;
    await _authService.signOut();
  }

  void clearError() {
    _error = null;
    notifyListeners();
  }

  void _setLoading(bool value) {
    _loading = value;
    notifyListeners();
  }

  String _mapAuthError(String code) {
    switch (code) {
      case 'user-not-found':
        return 'No account found with this email';
      case 'wrong-password':
        return 'Incorrect password';
      case 'invalid-email':
        return 'Invalid email address';
      case 'user-disabled':
        return 'This account has been disabled';
      case 'email-already-in-use':
        return 'An account with this email already exists. Your account may have been set up by the practice — try signing in instead.';
      case 'weak-password':
        return 'Password is too weak';
      case 'too-many-requests':
        return 'Too many attempts. Please try again later';
      case 'invalid-credential':
        return 'Invalid email or password';
      default:
        return 'Authentication failed. Please try again';
    }
  }

  @override
  void dispose() {
    _authSubscription?.cancel();
    _profileSubscription?.cancel();
    super.dispose();
  }
}
