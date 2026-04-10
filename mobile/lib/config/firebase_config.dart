import 'dart:io';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:cloud_functions/cloud_functions.dart';
import '../firebase_options.dart';

class FirebaseConfig {
  static bool _initialized = false;
  static bool _useEmulator = false;

  static bool get useEmulator => _useEmulator;

  /// Initialize Firebase and optionally connect to emulators.
  /// Set [useEmulator] to true for local development.
  static Future<void> initialize({bool useEmulator = false}) async {
    if (_initialized) return;

    await Firebase.initializeApp(
      options: DefaultFirebaseOptions.currentPlatform,
    );

    _useEmulator = useEmulator;

    if (useEmulator) {
      await _connectEmulators();
    }

    _initialized = true;
  }

  static Future<void> _connectEmulators() async {
    // Use 10.0.2.2 for Android emulator (maps to host localhost),
    // localhost for iOS simulator
    final host = Platform.isAndroid ? '10.0.2.2' : 'localhost';

    await FirebaseAuth.instance.useAuthEmulator(host, 9099);
    FirebaseFirestore.instance.useFirestoreEmulator(host, 8080);
    FirebaseStorage.instance.useStorageEmulator(host, 9199);
    FirebaseFunctions.instance.useFunctionsEmulator(host, 5001);
  }
}
