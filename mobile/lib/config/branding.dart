/// Branding configuration — single source of truth for per-customer customization.
///
/// Fork this repository per customer and edit this file to rebrand the mobile
/// app. Keep values in sync with web/src/config/branding.ts.
///
/// Asset files live under mobile/assets/branding/ — swap them out and run
/// `flutter pub get` after updating pubspec.yaml asset paths if needed.
library;

class BrandingAgent {
  /// Display name, e.g. "Aurelia" or "Sunny"
  final String name;

  /// One-line tagline
  final String tagline;

  const BrandingAgent({required this.name, required this.tagline});
}

class BrandingColors {
  /// Primary brand color in #RRGGBB
  final String primary;

  /// Secondary brand color in #RRGGBB
  final String secondary;

  /// Accent color for highlights
  final String accent;

  const BrandingColors({
    required this.primary,
    required this.secondary,
    required this.accent,
  });
}

class BrandingPlatformVendor {
  /// Legal name of the platform vendor that bills the practice
  final String name;

  /// Support email for platform billing questions
  final String supportEmail;

  /// Short descriptor on the practice's credit card statement
  final String billingDescriptor;

  const BrandingPlatformVendor({
    required this.name,
    required this.supportEmail,
    required this.billingDescriptor,
  });
}

class BrandingAddress {
  /// Street line, e.g. "500 Main Street"
  final String street;

  /// City, e.g. "Palo Alto"
  final String city;

  /// State two-letter code, e.g. "CA"
  final String state;

  /// ZIP code
  final String zip;

  /// Single-line form for display, e.g. "500 Main Street, Palo Alto, CA 94301"
  final String full;

  /// Google Maps query fragment, e.g. "500+Main+Street+Palo+Alto+CA+94301"
  final String mapsQuery;

  const BrandingAddress({
    required this.street,
    required this.city,
    required this.state,
    required this.zip,
    required this.full,
    required this.mapsQuery,
  });
}

class BrandingHours {
  /// Day or day range, e.g. "Monday – Friday"
  final String day;

  /// Time range, e.g. "9:00 AM – 5:00 PM" or "Closed"
  final String time;

  const BrandingHours({required this.day, required this.time});
}

class BrandingLogos {
  /// Full logo for light backgrounds (assets/branding/logo.png)
  final String full;

  /// Full logo for dark backgrounds
  final String fullDark;

  /// Icon-only variant for small surfaces
  final String icon;

  const BrandingLogos({
    required this.full,
    required this.fullDark,
    required this.icon,
  });
}

class Branding {
  /// App/product display name (matches BRANDING.appName on the web)
  final String appName;

  /// Full legal/display name of the practice
  final String practiceName;

  /// Short marketing name (headers, emails, SMS)
  final String shortName;

  /// Legal entity for legal/audit pages
  final String legalEntity;

  /// Public customer-facing domain, without protocol
  final String domain;

  /// Android package name (matches `applicationId` in
  /// `mobile/android/app/build.gradle.kts`). Used by email-link sign-in
  /// so Firebase can generate a link that deep-opens this app — must
  /// match the real package id or the link opens the wrong app.
  final String androidPackageName;

  /// iOS bundle id (matches `PRODUCT_BUNDLE_IDENTIFIER` in the Xcode
  /// project). Used by email-link sign-in for the same reason.
  final String iosBundleId;

  /// Public support email
  final String supportEmail;

  /// Email sender address for transactional emails (verification, invites).
  /// Shown to patients in "check your spam folder" copy.
  final String fromEmail;

  /// Optional public support phone
  final String? supportPhone;

  /// Optional fax number
  final String? fax;

  /// Physical office address
  final BrandingAddress address;

  /// Office hours list for the Contact screen
  final List<BrandingHours> hours;

  /// Default appointment duration in minutes
  final int defaultAppointmentDuration;

  /// Brand color palette
  final BrandingColors colors;

  /// Logo asset paths (under assets/branding/ in pubspec.yaml)
  final BrandingLogos logos;

  /// Admin AI agent identity
  final BrandingAgent adminAgent;

  /// Patient support AI agent identity
  final BrandingAgent patientAgent;

  /// Platform vendor (you) — the entity the practice pays to run the system
  final BrandingPlatformVendor platformVendor;

  const Branding({
    required this.appName,
    required this.practiceName,
    required this.shortName,
    required this.legalEntity,
    required this.domain,
    required this.androidPackageName,
    required this.iosBundleId,
    required this.supportEmail,
    required this.fromEmail,
    this.supportPhone,
    this.fax,
    required this.address,
    required this.hours,
    required this.defaultAppointmentDuration,
    required this.colors,
    required this.logos,
    required this.adminAgent,
    required this.patientAgent,
    required this.platformVendor,
  });
}

const branding = Branding(
  appName: 'Aurelia MD',
  practiceName: 'Aurelia MD',
  shortName: 'Aurelia MD',
  legalEntity: 'Aurelia Primary Care, LLC',
  domain: 'patient-demo-project.web.app',
  androidPackageName: 'com.aureliamd.patient',
  iosBundleId: 'com.aureliamd.patient',
  supportEmail: 'support@aureliamd.com',
  fromEmail: 'noreply@aureliamd.com',
  supportPhone: null,
  fax: null,
  address: BrandingAddress(
    street: '500 Main Street',
    city: 'Palo Alto',
    state: 'CA',
    zip: '94301',
    full: '500 Main Street, Palo Alto, CA 94301',
    mapsQuery: '500+Main+Street+Palo+Alto+CA+94301',
  ),
  hours: [
    BrandingHours(day: 'Monday – Friday', time: '9:00 AM – 5:00 PM'),
    BrandingHours(day: 'Saturday – Sunday', time: 'Closed'),
  ],
  defaultAppointmentDuration: 20,
  colors: BrandingColors(
    primary: '#0F766E',
    secondary: '#475569',
    accent: '#F59E0B',
  ),
  logos: BrandingLogos(
    full: 'assets/branding/logo.png',
    fullDark: 'assets/branding/logo-dark.png',
    icon: 'assets/branding/icon.png',
  ),
  adminAgent: BrandingAgent(
    name: 'Aurelia',
    tagline: 'Your practice management assistant',
  ),
  patientAgent: BrandingAgent(
    name: 'Sunny',
    tagline: 'Here to help with your questions',
  ),
  platformVendor: BrandingPlatformVendor(
    name: 'Patient Portal Inc.',
    supportEmail: 'billing@patientportal.example',
    billingDescriptor: 'PATIENT PORTAL',
  ),
);
