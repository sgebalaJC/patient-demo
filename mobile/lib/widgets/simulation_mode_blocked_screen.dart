import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../config/branding.dart';
import '../config/colors.dart';
import '../providers/auth_provider.dart';

/// Shown when `system/settings.simulationMode === true`.
///
/// The mobile app does not branch reads/writes between real and `simulation/*`
/// collections the way the web admin does, so a patient who signs in during
/// a demo session would see an empty app backed by the wrong data. Rather
/// than half-wiring simulation support, we block the app entirely while sim
/// mode is on — demo flows live on the web for now.
class SimulationModeBlockedScreen extends StatelessWidget {
  const SimulationModeBlockedScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.read<AuthProvider>();
    return PopScope(
      canPop: false,
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: SafeArea(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(32),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 80,
                    height: 80,
                    decoration: BoxDecoration(
                      color: Colors.amber.shade50,
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      Icons.science_outlined,
                      size: 40,
                      color: Colors.amber.shade800,
                    ),
                  ),
                  const SizedBox(height: 24),
                  Text(
                    'Demo mode active',
                    style: TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.bold,
                      color: AppColors.textDark,
                    ),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 12),
                  Text(
                    'The mobile app is not available while the practice is running '
                    'in simulation mode. Use ${branding.domain} to explore the demo, '
                    'or wait for the practice to switch back to live data.',
                    style: TextStyle(
                      fontSize: 15,
                      color: Colors.grey.shade600,
                      height: 1.5,
                    ),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 32),
                  if (auth.firebaseUser != null)
                    SizedBox(
                      width: double.infinity,
                      child: ElevatedButton(
                        onPressed: () => auth.signOut(),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.primary,
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(10),
                          ),
                        ),
                        child: const Text(
                          'Sign Out',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
