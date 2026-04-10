import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:google_sign_in/google_sign_in.dart';
import '../models/user.dart';

class AuthService {
  final FirebaseAuth _auth = FirebaseAuth.instance;
  final FirebaseFirestore _db = FirebaseFirestore.instance;

  User? get currentUser => _auth.currentUser;
  Stream<User?> get authStateChanges => _auth.authStateChanges();

  /// Get user profile from Firestore
  Future<AppUser?> getUserProfile(String uid) async {
    final doc = await _db.collection('users').doc(uid).get();
    if (!doc.exists) return null;
    return AppUser.fromFirestore(doc);
  }

  /// Listen to user profile changes in real-time
  Stream<AppUser?> userProfileStream(String uid) {
    return _db.collection('users').doc(uid).snapshots().map((doc) {
      if (!doc.exists) return null;
      return AppUser.fromFirestore(doc);
    });
  }

  /// Sign in with email and password
  Future<UserCredential> signInWithEmail(String email, String password) async {
    final credential = await _auth.signInWithEmailAndPassword(
      email: email,
      password: password,
    );
    await _updateLastLogin(credential.user!.uid);
    return credential;
  }

  /// Sign up with email and password
  Future<UserCredential> signUpWithEmail({
    required String email,
    required String password,
    String? firstName,
    String? lastName,
    String? phoneNumber,
  }) async {
    final credential = await _auth.createUserWithEmailAndPassword(
      email: email,
      password: password,
    );

    final user = credential.user!;

    if (firstName != null || lastName != null) {
      await user.updateDisplayName(
        [firstName, lastName].where((s) => s != null).join(' '),
      );
    }

    // Create user document in Firestore
    await _db.collection('users').doc(user.uid).set({
      'email': email,
      ...(firstName != null ? {'firstName': firstName} : {}),
      ...(lastName != null ? {'lastName': lastName} : {}),
      'displayName': [firstName, lastName].where((s) => s != null).join(' '),
      ...(phoneNumber != null ? {'phoneNumber': phoneNumber} : {}),
      'role': 'patient',
      'isActive': false, // Requires admin activation in production
      'emailVerified': false,
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
      'lastLoginAt': FieldValue.serverTimestamp(),
    });

    return credential;
  }

  /// Initialize Google Sign-In (must be called once at app startup)
  static Future<void> initGoogleSignIn() async {
    await GoogleSignIn.instance.initialize(
      serverClientId:
          '1024582536287-cj6rneod4unjd79im3nrreg9jet6vo2n.apps.googleusercontent.com',
    );
  }

  /// Sign in with Google
  Future<UserCredential> signInWithGoogle() async {
    final account = await GoogleSignIn.instance.authenticate();
    final idToken = account.authentication.idToken;

    final credential = GoogleAuthProvider.credential(
      idToken: idToken,
    );

    final userCredential = await _auth.signInWithCredential(credential);
    final user = userCredential.user!;

    // Create or update user document
    final userDoc = await _db.collection('users').doc(user.uid).get();
    if (!userDoc.exists) {
      final nameParts = (user.displayName ?? '').split(' ');
      await _db.collection('users').doc(user.uid).set({
        'email': user.email,
        'firstName': nameParts.isNotEmpty ? nameParts.first : null,
        'lastName': nameParts.length > 1 ? nameParts.sublist(1).join(' ') : null,
        'displayName': user.displayName,
        'phoneNumber': user.phoneNumber,
        'role': 'patient',
        'isActive': false,
        'emailVerified': user.emailVerified,
        'createdAt': FieldValue.serverTimestamp(),
        'updatedAt': FieldValue.serverTimestamp(),
        'lastLoginAt': FieldValue.serverTimestamp(),
      });
    } else {
      await _updateLastLogin(user.uid);
    }

    return userCredential;
  }

  /// Send password reset email
  Future<void> resetPassword(String email) async {
    await _auth.sendPasswordResetEmail(email: email);
  }

  /// Sign out
  Future<void> signOut() async {
    await GoogleSignIn.instance.signOut();
    await _auth.signOut();
  }

  // Phone OTP login

  /// Send phone login OTP code
  Future<Map<String, dynamic>> sendPhoneLoginCode(String phoneNumber) async {
    final fn = FirebaseFunctions.instance.httpsCallable('sendPhoneLoginCode');
    final result = await fn.call({'phoneNumber': phoneNumber});
    return Map<String, dynamic>.from(result.data as Map);
  }

  /// Verify phone login OTP and sign in
  Future<Map<String, dynamic>> verifyPhoneLogin(
    String phoneNumber,
    String code, {
    String? firstName,
    String? lastName,
  }) async {
    final fn = FirebaseFunctions.instance.httpsCallable('verifyPhoneLogin');
    final result = await fn.call({
      'phoneNumber': phoneNumber,
      'code': code,
      if (firstName != null) 'firstName': firstName,
      if (lastName != null) 'lastName': lastName,
    });
    final data = Map<String, dynamic>.from(result.data as Map);

    if (data['success'] == true && data['token'] != null) {
      await _auth.signInWithCustomToken(data['token'] as String);
    }

    return data;
  }

  Future<void> _updateLastLogin(String uid) async {
    await _db.collection('users').doc(uid).update({
      'lastLoginAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }
}
