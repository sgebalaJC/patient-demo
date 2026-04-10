import 'package:flutter/material.dart';

/// App-wide colors. Dynamic properties are updated by ThemeProvider
/// when the user switches themes, so all widgets pick up the new colors
/// on the next build.
class AppColors {
  static Color primary = const Color(0xFF2563EB);   // Classic blue (default)
  static Color accent = const Color(0xFF64748B);     // Classic gray

  // Surface colors — updated per theme
  static Color background = const Color(0xFFF9FAFB);
  static Color surfaceCard = const Color(0xFFFFFFFF);
  static Color textDark = const Color(0xFF1F2937);
  static Color textMedium = const Color(0xFF6B7280);
  static Color navBarBg = const Color(0xFFFFFFFF);
  static Color divider = const Color(0xFFE5E7EB);

  // Aliases used by newer screens
  static Color get border => divider;
  static Color get textPrimary => textDark;
  static Color get textSecondary => textMedium;

  // Semantic colors — constant across all themes
  static const Color success = Color(0xFF059669);
  static const Color warning = Color(0xFFD97706);
  static const Color error = Color(0xFFDC2626);
  static const Color errorBg = Color(0xFFFEF2F2);
  static const Color successBg = Color(0xFFF0FDF4);
  static const Color purple = Color(0xFF7C3AED);

  /// Apply dark surface colors
  static void applyDarkSurfaces() {
    background = const Color(0xFF0B1120);
    surfaceCard = const Color(0xFF131C2E);
    textDark = const Color(0xFFF9FAFB);
    textMedium = const Color(0xFF9CA3AF);
    navBarBg = const Color(0xFF111827);
    divider = const Color(0xFF1E293B);
  }

  /// Apply light surface colors
  static void applyLightSurfaces() {
    background = const Color(0xFFF9FAFB);
    surfaceCard = const Color(0xFFFFFFFF);
    textDark = const Color(0xFF1F2937);
    textMedium = const Color(0xFF6B7280);
    navBarBg = const Color(0xFFFFFFFF);
    divider = const Color(0xFFE5E7EB);
  }
}
