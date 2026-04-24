import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'config/firebase_config.dart';
import 'config/colors.dart';
import 'config/branding.dart';
import 'providers/app_settings_provider.dart';
import 'providers/auth_provider.dart';
import 'providers/theme_provider.dart';
import 'services/auth_service.dart';
import 'services/fcm_service.dart';
import 'screens/auth/login_screen.dart';
import 'screens/dashboard_screen.dart';
import 'screens/appointments/appointments_screen.dart';
import 'screens/messages/messages_screen.dart';
import 'screens/refills/refills_screen.dart';
import 'screens/profile_screen.dart';
import 'widgets/admin_blocked_modal.dart';
import 'widgets/inactive_account_screen.dart';
import 'widgets/biometric_lock_screen.dart';
import 'widgets/simulation_mode_blocked_screen.dart';

@pragma('vm:entry-point')
Future<void> _firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  // Background messages are handled by the OS notification tray.
  // Firebase is already initialized by the time this runs.
}

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Set useEmulator: true for local development with Firebase emulators
  await SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
  await FirebaseConfig.initialize(useEmulator: false);
  await AuthService.initGoogleSignIn();

  FirebaseMessaging.onBackgroundMessage(_firebaseMessagingBackgroundHandler);

  runApp(const PatientPortalApp());
}

class PatientPortalApp extends StatelessWidget {
  const PatientPortalApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AppSettingsProvider()),
        ChangeNotifierProvider(create: (_) => AuthProvider()),
        ChangeNotifierProvider(create: (_) => ThemeProvider()),
      ],
      child: Consumer<ThemeProvider>(
        builder: (context, themeProvider, _) {
          // Update system UI overlay based on theme
          SystemChrome.setSystemUIOverlayStyle(
            themeProvider.isDark
                ? SystemUiOverlayStyle.light
                : SystemUiOverlayStyle.dark,
          );

          return MaterialApp(
            title: branding.shortName,
            debugShowCheckedModeBanner: false,
            theme: themeProvider.buildThemeData(),
            home: const AuthGate(),
          );
        },
      ),
    );
  }
}

/// Routes users based on auth state:
/// - simulationMode on → Sim-blocked screen (mobile does not branch to simulation/*)
/// - Unauthenticated → Login
/// - Admin / unknown role → Blocked modal
/// - Inactive patient → Pending activation screen
/// - Biometric locked → Biometric prompt
/// - Active patient → Main app
class AuthGate extends StatelessWidget {
  const AuthGate({super.key});

  @override
  Widget build(BuildContext context) {
    return Consumer2<AppSettingsProvider, AuthProvider>(
      builder: (context, settings, auth, _) {
        if (settings.simulationMode) {
          return const SimulationModeBlockedScreen();
        }
        switch (auth.status) {
          case AuthStatus.uninitialized:
            return const Scaffold(
              body: Center(child: CircularProgressIndicator()),
            );
          case AuthStatus.unauthenticated:
            return const LoginScreen();
          case AuthStatus.adminBlocked:
            return const AdminBlockedModal();
          case AuthStatus.inactive:
            return const InactiveAccountScreen();
          case AuthStatus.biometricLocked:
            return const BiometricLockScreen();
          case AuthStatus.authenticated:
            return const MainShell();
        }
      },
    );
  }
}

/// Bottom navigation shell for authenticated patients
class MainShell extends StatefulWidget {
  const MainShell({super.key});

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  int _currentIndex = 0;

  @override
  void initState() {
    super.initState();
    // Notification taps with a threadId jump us to the Messages tab;
    // MessagesScreen itself pushes the ThreadDetailScreen.
    FcmService.pendingThreadId.addListener(_onThreadDeepLink);
  }

  @override
  void dispose() {
    FcmService.pendingThreadId.removeListener(_onThreadDeepLink);
    super.dispose();
  }

  void _onThreadDeepLink() {
    if (FcmService.pendingThreadId.value != null && _currentIndex != 2) {
      setState(() => _currentIndex = 2);
    }
  }

  void _navigateTo(int index) {
    setState(() => _currentIndex = index);
  }

  @override
  Widget build(BuildContext context) {
    // Watch theme to rebuild all screens with new colors
    final themeProvider = context.watch<ThemeProvider>();
    final themeId = themeProvider.currentId;

    return Scaffold(
      body: IndexedStack(
        // Force recreate children when theme changes
        key: ValueKey(themeId),
        index: _currentIndex,
        children: [
          DashboardScreen(onNavigate: _navigateTo),
          AppointmentsScreen(onBack: () => _navigateTo(0)),
          MessagesScreen(onBack: () => _navigateTo(0)),
          RefillsScreen(onBack: () => _navigateTo(0)),
          ProfileScreen(onBack: () => _navigateTo(0)),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _currentIndex,
        onDestinationSelected: (index) {
          setState(() => _currentIndex = index);
        },
        backgroundColor: AppColors.navBarBg,
        indicatorColor: AppColors.primary.withValues(alpha: 0.1),
        labelBehavior: NavigationDestinationLabelBehavior.alwaysHide,
        height: 56,
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home),
            label: '',
          ),
          NavigationDestination(
            icon: Icon(Icons.calendar_today_outlined),
            selectedIcon: Icon(Icons.calendar_today),
            label: '',
          ),
          NavigationDestination(
            icon: Icon(Icons.message_outlined),
            selectedIcon: Icon(Icons.message),
            label: '',
          ),
          NavigationDestination(
            icon: Icon(Icons.medication_outlined),
            selectedIcon: Icon(Icons.medication),
            label: '',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline),
            selectedIcon: Icon(Icons.person),
            label: '',
          ),
        ],
      ),
    );
  }
}
