import 'package:cloud_firestore/cloud_firestore.dart';

// Mobile is patient-only — admin is parsed but blocked at the auth gate.
// `super_admin` from web is mapped to `admin` here for safety.
enum UserRole { patient, admin }

class AppUser {
  final String id;
  final String? email;
  final String? firstName;
  final String? lastName;
  final String? displayName;
  final String? phoneNumber;
  final UserRole role;
  final bool isActive;
  final bool? emailVerified;
  final bool? phoneVerified;
  final DateTime? dateOfBirth;
  final DateTime? createdAt;
  final DateTime? updatedAt;
  final DateTime? lastLoginAt;
  final List<String> tutorialCompletedSections;
  final List<String> tutorialSkippedSections;
  final DateTime? tutorialDismissedAt;
  final bool intakeFormSkipped;

  AppUser({
    required this.id,
    this.email,
    this.firstName,
    this.lastName,
    this.displayName,
    this.phoneNumber,
    this.role = UserRole.patient,
    this.isActive = true,
    this.emailVerified,
    this.phoneVerified,
    this.dateOfBirth,
    this.createdAt,
    this.updatedAt,
    this.lastLoginAt,
    this.tutorialCompletedSections = const [],
    this.tutorialSkippedSections = const [],
    this.tutorialDismissedAt,
    this.intakeFormSkipped = false,
  });

  String get fullName {
    if (firstName != null && lastName != null) {
      return '$firstName $lastName';
    }
    return displayName ?? email ?? 'User';
  }

  bool get isPatient => role == UserRole.patient;
  bool get isAdmin => role == UserRole.admin;

  factory AppUser.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>;
    return AppUser(
      id: doc.id,
      email: data['email'] ?? '',
      firstName: data['firstName'],
      lastName: data['lastName'],
      displayName: data['displayName'],
      phoneNumber: data['phoneNumber'],
      role: _parseRole(data['role']),
      isActive: data['isActive'] ?? false,
      emailVerified: data['emailVerified'],
      phoneVerified: data['phoneVerified'],
      dateOfBirth: _parseTimestamp(data['dateOfBirth']),
      createdAt: _parseTimestamp(data['createdAt']),
      updatedAt: _parseTimestamp(data['updatedAt']),
      lastLoginAt: _parseTimestamp(data['lastLoginAt']),
      tutorialCompletedSections:
          (data['tutorialCompletedSections'] as List<dynamic>?)?.cast<String>() ?? [],
      tutorialSkippedSections:
          (data['tutorialSkippedSections'] as List<dynamic>?)?.cast<String>() ?? [],
      tutorialDismissedAt: _parseTimestamp(data['tutorialDismissedAt']),
      intakeFormSkipped: data['intakeFormSkipped'] ?? false,
    );
  }

  Map<String, dynamic> toFirestore() {
    return {
      'email': email,
      if (firstName != null) 'firstName': firstName,
      if (lastName != null) 'lastName': lastName,
      if (displayName != null) 'displayName': displayName,
      if (phoneNumber != null) 'phoneNumber': phoneNumber,
      'role': role.name,
      'isActive': isActive,
      if (emailVerified != null) 'emailVerified': emailVerified,
      if (phoneVerified != null) 'phoneVerified': phoneVerified,
      'updatedAt': FieldValue.serverTimestamp(),
    };
  }

  static UserRole _parseRole(String? role) {
    switch (role) {
      case 'admin':
      case 'super_admin':
        return UserRole.admin;
      default:
        return UserRole.patient;
    }
  }

  static DateTime? _parseTimestamp(dynamic value) {
    if (value is Timestamp) return value.toDate();
    return null;
  }
}
