import 'package:cloud_firestore/cloud_firestore.dart';

enum IntakeFormStatus { draft, inProgress, completed, approved, rejected }

class PatientInfoForm {
  final String fullName;
  final String dateOfBirth;
  final String phoneNumber;
  final String gender; // male, female
  final String emailAddress;
  final String address;
  final String emergencyContactName;
  final String emergencyContactRelationship;
  final String emergencyContactPhone;
  final String? insuranceProvider;
  final String? policyNumber;
  final String? groupNumber;
  final String? pharmacyName;
  final String? pharmacyPhone;
  final String? pharmacyAddress;
  final DateTime? completedAt;

  PatientInfoForm({
    this.fullName = '',
    this.dateOfBirth = '',
    this.phoneNumber = '',
    this.gender = 'male',
    this.emailAddress = '',
    this.address = '',
    this.emergencyContactName = '',
    this.emergencyContactRelationship = '',
    this.emergencyContactPhone = '',
    this.insuranceProvider,
    this.policyNumber,
    this.groupNumber,
    this.pharmacyName,
    this.pharmacyPhone,
    this.pharmacyAddress,
    this.completedAt,
  });

  factory PatientInfoForm.fromMap(Map<String, dynamic> data) {
    return PatientInfoForm(
      fullName: data['fullName'] ?? '',
      dateOfBirth: data['dateOfBirth'] ?? '',
      phoneNumber: data['phoneNumber'] ?? '',
      gender: data['gender'] ?? 'male',
      emailAddress: data['emailAddress'] ?? '',
      address: data['address'] ?? '',
      emergencyContactName: data['emergencyContactName'] ?? '',
      emergencyContactRelationship: data['emergencyContactRelationship'] ?? '',
      emergencyContactPhone: data['emergencyContactPhone'] ?? '',
      insuranceProvider: data['insuranceProvider'],
      policyNumber: data['policyNumber'],
      groupNumber: data['groupNumber'],
      pharmacyName: data['pharmacyName'],
      pharmacyPhone: data['pharmacyPhone'],
      pharmacyAddress: data['pharmacyAddress'],
      completedAt: _parseTimestamp(data['completedAt']),
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'fullName': fullName,
      'dateOfBirth': dateOfBirth,
      'phoneNumber': phoneNumber,
      'gender': gender,
      'emailAddress': emailAddress,
      'address': address,
      'emergencyContactName': emergencyContactName,
      'emergencyContactRelationship': emergencyContactRelationship,
      'emergencyContactPhone': emergencyContactPhone,
      if (insuranceProvider != null) 'insuranceProvider': insuranceProvider,
      if (policyNumber != null) 'policyNumber': policyNumber,
      if (groupNumber != null) 'groupNumber': groupNumber,
      if (pharmacyName != null) 'pharmacyName': pharmacyName,
      if (pharmacyPhone != null) 'pharmacyPhone': pharmacyPhone,
      if (pharmacyAddress != null) 'pharmacyAddress': pharmacyAddress,
      'completedAt': FieldValue.serverTimestamp(),
    };
  }
}

class Allergy {
  final String allergen;
  final String reaction;

  Allergy({
    required this.allergen,
    required this.reaction,
  });

  factory Allergy.fromMap(Map<String, dynamic> data) {
    return Allergy(
      allergen: data['allergen'] ?? '',
      reaction: data['reaction'] ?? '',
    );
  }

  Map<String, dynamic> toMap() => {
    'allergen': allergen,
    'reaction': reaction,
  };
}

class MedicalHistoryForm {
  final String? medicalHistory;
  final String? hospitalizations;
  final String? pastSurgicalHistory;
  final String? currentMedications;
  final List<Allergy> allergies;
  final String smokingStatus; // never, former, current
  final String? smokingDetails;
  final String alcoholConsumption; // none, occasional, moderate, heavy
  final String? alcoholDetails;
  final String exerciseFrequency; // none, rarely, weekly, daily
  final String? exerciseDetails;
  final DateTime? completedAt;

  MedicalHistoryForm({
    this.medicalHistory,
    this.hospitalizations,
    this.pastSurgicalHistory,
    this.currentMedications,
    this.allergies = const [],
    this.smokingStatus = 'never',
    this.smokingDetails,
    this.alcoholConsumption = 'none',
    this.alcoholDetails,
    this.exerciseFrequency = 'none',
    this.exerciseDetails,
    this.completedAt,
  });

  factory MedicalHistoryForm.fromMap(Map<String, dynamic> data) {
    return MedicalHistoryForm(
      medicalHistory: data['medicalHistory'],
      hospitalizations: data['hospitalizations'],
      pastSurgicalHistory: data['pastSurgicalHistory'],
      currentMedications: data['currentMedications'],
      allergies: (data['allergies'] as List<dynamic>?)
              ?.map((a) => Allergy.fromMap(a as Map<String, dynamic>))
              .toList() ??
          [],
      smokingStatus: data['smokingStatus'] ?? 'never',
      smokingDetails: data['smokingDetails'],
      alcoholConsumption: data['alcoholConsumption'] ?? 'none',
      alcoholDetails: data['alcoholDetails'],
      exerciseFrequency: data['exerciseFrequency'] ?? 'none',
      exerciseDetails: data['exerciseDetails'],
      completedAt: _parseTimestamp(data['completedAt']),
    );
  }

  Map<String, dynamic> toMap() {
    return {
      if (medicalHistory != null) 'medicalHistory': medicalHistory,
      if (hospitalizations != null) 'hospitalizations': hospitalizations,
      if (pastSurgicalHistory != null) 'pastSurgicalHistory': pastSurgicalHistory,
      if (currentMedications != null) 'currentMedications': currentMedications,
      'allergies': allergies.map((a) => a.toMap()).toList(),
      'smokingStatus': smokingStatus,
      if (smokingDetails != null) 'smokingDetails': smokingDetails,
      'alcoholConsumption': alcoholConsumption,
      if (alcoholDetails != null) 'alcoholDetails': alcoholDetails,
      'exerciseFrequency': exerciseFrequency,
      if (exerciseDetails != null) 'exerciseDetails': exerciseDetails,
      'completedAt': FieldValue.serverTimestamp(),
    };
  }
}

class ConsentForm {
  final bool treatmentConsent;
  final bool hipaaConsent;
  final bool financialResponsibility;
  final bool communicationConsent;
  final bool telemedConsent;
  final bool emergencyConsent;
  final bool photographyConsent;
  final bool researchParticipation;
  final bool marketingCommunications;
  final String patientSignature;
  final String signatureDate;
  final DateTime? completedAt;

  ConsentForm({
    this.treatmentConsent = false,
    this.hipaaConsent = false,
    this.financialResponsibility = false,
    this.communicationConsent = false,
    this.telemedConsent = false,
    this.emergencyConsent = false,
    this.photographyConsent = false,
    this.researchParticipation = false,
    this.marketingCommunications = false,
    this.patientSignature = '',
    this.signatureDate = '',
    this.completedAt,
  });

  factory ConsentForm.fromMap(Map<String, dynamic> data) {
    return ConsentForm(
      treatmentConsent: data['treatmentConsent'] ?? false,
      hipaaConsent: data['hipaaConsent'] ?? false,
      financialResponsibility: data['financialResponsibility'] ?? false,
      communicationConsent: data['communicationConsent'] ?? false,
      telemedConsent: data['telemedConsent'] ?? false,
      emergencyConsent: data['emergencyConsent'] ?? false,
      photographyConsent: data['photographyConsent'] ?? false,
      researchParticipation: data['researchParticipation'] ?? false,
      marketingCommunications: data['marketingCommunications'] ?? false,
      patientSignature: data['patientSignature'] ?? '',
      signatureDate: data['signatureDate'] ?? '',
      completedAt: _parseTimestamp(data['completedAt']),
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'treatmentConsent': treatmentConsent,
      'hipaaConsent': hipaaConsent,
      'financialResponsibility': financialResponsibility,
      'communicationConsent': communicationConsent,
      'telemedConsent': telemedConsent,
      'emergencyConsent': emergencyConsent,
      'photographyConsent': photographyConsent,
      'researchParticipation': researchParticipation,
      'marketingCommunications': marketingCommunications,
      'patientSignature': patientSignature,
      'signatureDate': signatureDate,
      'completedAt': FieldValue.serverTimestamp(),
    };
  }
}

class EmergencyContact {
  final String name;
  final String relationship;
  final String phoneNumber;

  EmergencyContact({
    required this.name,
    required this.relationship,
    required this.phoneNumber,
  });

  factory EmergencyContact.fromMap(Map<String, dynamic> data) {
    return EmergencyContact(
      name: data['name'] ?? '',
      relationship: data['relationship'] ?? '',
      phoneNumber: data['phoneNumber'] ?? '',
    );
  }

  Map<String, dynamic> toMap() => {
    'name': name,
    'relationship': relationship,
    'phoneNumber': phoneNumber,
  };
}

class ConciergeAgreement {
  final String membershipPlan; // basic, premium, executive
  final String membershipDuration; // monthly, annual
  final bool agreementAcceptance;
  final bool paymentAuthorization;
  final bool serviceAgreement;
  final bool cancellationPolicy;
  final EmergencyContact? emergencyContact;
  final List<String> preferredAppointmentTimes;
  final List<String> communicationPreferences;
  final String? specialRequests;
  final String patientSignature;
  final String signatureDate;
  final DateTime? completedAt;

  ConciergeAgreement({
    this.membershipPlan = 'basic',
    this.membershipDuration = 'monthly',
    this.agreementAcceptance = false,
    this.paymentAuthorization = false,
    this.serviceAgreement = false,
    this.cancellationPolicy = false,
    this.emergencyContact,
    this.preferredAppointmentTimes = const [],
    this.communicationPreferences = const [],
    this.specialRequests,
    this.patientSignature = '',
    this.signatureDate = '',
    this.completedAt,
  });

  factory ConciergeAgreement.fromMap(Map<String, dynamic> data) {
    return ConciergeAgreement(
      membershipPlan: data['membershipPlan'] ?? 'basic',
      membershipDuration: data['membershipDuration'] ?? 'monthly',
      agreementAcceptance: data['agreementAcceptance'] ?? false,
      paymentAuthorization: data['paymentAuthorization'] ?? false,
      serviceAgreement: data['serviceAgreement'] ?? false,
      cancellationPolicy: data['cancellationPolicy'] ?? false,
      emergencyContact: data['emergencyContact'] != null
          ? EmergencyContact.fromMap(data['emergencyContact'] as Map<String, dynamic>)
          : null,
      preferredAppointmentTimes:
          (data['preferredAppointmentTimes'] as List<dynamic>?)?.cast<String>() ?? [],
      communicationPreferences:
          (data['communicationPreferences'] as List<dynamic>?)?.cast<String>() ?? [],
      specialRequests: data['specialRequests'],
      patientSignature: data['patientSignature'] ?? '',
      signatureDate: data['signatureDate'] ?? '',
      completedAt: _parseTimestamp(data['completedAt']),
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'membershipPlan': membershipPlan,
      'membershipDuration': membershipDuration,
      'agreementAcceptance': agreementAcceptance,
      'paymentAuthorization': paymentAuthorization,
      'serviceAgreement': serviceAgreement,
      'cancellationPolicy': cancellationPolicy,
      if (emergencyContact != null) 'emergencyContact': emergencyContact!.toMap(),
      'preferredAppointmentTimes': preferredAppointmentTimes,
      'communicationPreferences': communicationPreferences,
      if (specialRequests != null) 'specialRequests': specialRequests,
      'patientSignature': patientSignature,
      'signatureDate': signatureDate,
      'completedAt': FieldValue.serverTimestamp(),
    };
  }
}

class PatientIntakeForm {
  final String id;
  final String patientId;
  final IntakeFormStatus status;
  final PatientInfoForm? patientInfo;
  final MedicalHistoryForm? medicalHistory;
  final ConsentForm? consentForm;
  final ConciergeAgreement? conciergeAgreement;
  final List<String> completedSections;
  final String currentSection;
  final DateTime? createdAt;
  final DateTime? updatedAt;
  final DateTime? completedAt;

  PatientIntakeForm({
    required this.id,
    required this.patientId,
    this.status = IntakeFormStatus.draft,
    this.patientInfo,
    this.medicalHistory,
    this.consentForm,
    this.conciergeAgreement,
    this.completedSections = const [],
    this.currentSection = 'patient-info',
    this.createdAt,
    this.updatedAt,
    this.completedAt,
  });

  factory PatientIntakeForm.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>;
    return PatientIntakeForm(
      id: doc.id,
      patientId: data['patientId'] ?? '',
      status: _parseStatus(data['status']),
      patientInfo: data['patientInfo'] != null
          ? PatientInfoForm.fromMap(data['patientInfo'] as Map<String, dynamic>)
          : null,
      medicalHistory: data['medicalHistory'] != null
          ? MedicalHistoryForm.fromMap(data['medicalHistory'] as Map<String, dynamic>)
          : null,
      consentForm: data['consentForm'] != null
          ? ConsentForm.fromMap(data['consentForm'] as Map<String, dynamic>)
          : null,
      conciergeAgreement: data['conciergeAgreement'] != null
          ? ConciergeAgreement.fromMap(data['conciergeAgreement'] as Map<String, dynamic>)
          : null,
      completedSections:
          (data['completedSections'] as List<dynamic>?)?.cast<String>() ?? [],
      currentSection: data['currentSection'] ?? 'patient-info',
      createdAt: _parseTimestamp(data['createdAt']),
      updatedAt: _parseTimestamp(data['updatedAt']),
      completedAt: _parseTimestamp(data['completedAt']),
    );
  }

  static IntakeFormStatus _parseStatus(String? status) {
    switch (status) {
      case 'in_progress':
        return IntakeFormStatus.inProgress;
      case 'completed':
        return IntakeFormStatus.completed;
      case 'approved':
        return IntakeFormStatus.approved;
      case 'rejected':
        return IntakeFormStatus.rejected;
      default:
        return IntakeFormStatus.draft;
    }
  }
}

DateTime? _parseTimestamp(dynamic value) {
  if (value is Timestamp) return value.toDate();
  return null;
}
