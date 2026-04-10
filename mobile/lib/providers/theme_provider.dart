import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../config/colors.dart';

const _storageKey = 'patient-theme';

enum AppThemeId { classic, brand, dark }

class AppThemeData {
  final String label;
  final Color primary;
  final Color accent;
  final bool isDark;

  const AppThemeData({
    required this.label,
    required this.primary,
    required this.accent,
    this.isDark = false,
  });
}

const Map<AppThemeId, AppThemeData> appThemes = {
  AppThemeId.classic: AppThemeData(
    label: 'Classic',
    primary: Color(0xFF2563EB),
    accent: Color(0xFF64748B),
  ),
  // Brand theme — edit these colors to match mobile/lib/config/branding.dart
  AppThemeId.brand: AppThemeData(
    label: 'Brand',
    primary: Color(0xFF0F766E),
    accent: Color(0xFF475569),
  ),
  AppThemeId.dark: AppThemeData(
    label: 'Dark',
    primary: Color(0xFF14B8A6),
    accent: Color(0xFF334155),
    isDark: true,
  ),
};

class ThemeProvider extends ChangeNotifier {
  AppThemeId _currentId = AppThemeId.classic;

  AppThemeId get currentId => _currentId;
  AppThemeData get current => appThemes[_currentId]!;
  bool get isDark => current.isDark;

  ThemeProvider() {
    _applyColors();
    _load();
  }

  void _applyColors() {
    final theme = current;
    AppColors.primary = theme.primary;
    AppColors.accent = theme.accent;
    if (theme.isDark) {
      AppColors.applyDarkSurfaces();
    } else {
      AppColors.applyLightSurfaces();
    }
  }

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    final saved = prefs.getString(_storageKey);
    if (saved == 'brand') {
      _currentId = AppThemeId.brand;
    } else if (saved == 'dark') {
      _currentId = AppThemeId.dark;
    } else {
      _currentId = AppThemeId.classic;
    }
    _applyColors();
    notifyListeners();
  }

  Future<void> setTheme(AppThemeId id) async {
    _currentId = id;
    _applyColors();
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_storageKey, id.name);
  }

  ThemeData buildThemeData() {
    final theme = current;
    final brightness = theme.isDark ? Brightness.dark : Brightness.light;
    return ThemeData(
      colorScheme: ColorScheme.fromSeed(
        seedColor: theme.primary,
        primary: theme.primary,
        brightness: brightness,
        surface: AppColors.surfaceCard,
      ),
      useMaterial3: true,
      brightness: brightness,
      scaffoldBackgroundColor: AppColors.background,
      cardColor: AppColors.surfaceCard,
      dialogTheme: DialogThemeData(
        backgroundColor: AppColors.surfaceCard,
      ),
      dividerColor: AppColors.divider,
      appBarTheme: AppBarTheme(
        backgroundColor: AppColors.surfaceCard,
        foregroundColor: AppColors.textDark,
        elevation: 0,
        scrolledUnderElevation: 1,
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: AppColors.surfaceCard,
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: theme.isDark ? Colors.transparent : theme.primary,
          foregroundColor: theme.isDark ? theme.primary : Colors.white,
          side: theme.isDark ? BorderSide(color: theme.primary) : null,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          elevation: theme.isDark ? 0 : 1,
        ),
      ),
      textTheme: GoogleFonts.jetBrainsMonoTextTheme(
        ThemeData(brightness: brightness).textTheme,
      ),
    );
  }
}
