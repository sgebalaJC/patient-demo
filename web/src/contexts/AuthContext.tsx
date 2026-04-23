import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User as FirebaseUser, signInWithPopup } from 'firebase/auth';
import { onAuthChange, signOut as firebaseSignOut, googleProvider, auth } from '../lib/firebase';
import { userOperations } from '../lib/firestore';
import { User as AppUser } from '../types';
import logger from '../lib/logger';
import { audit } from '../lib/audit';
import { isSuperAdminEmail } from '../lib/roles';

export interface AuthState {
  user: FirebaseUser | null;
  userProfile: AppUser | null;
  loading: boolean;
  signOut: () => Promise<void>;
  error: string | null;
  impersonating: boolean;
  exitImpersonation: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error] = useState<string | null>(null);
  const [impersonating, setImpersonating] = useState(
    () => !!sessionStorage.getItem('impersonation'),
  );

  const handleSignOut = async () => {
    try {
      sessionStorage.removeItem('impersonation');
      setImpersonating(false);
      audit({ action: 'auth.logout' });
      await firebaseSignOut();
    } catch (err: any) {
      logger.error('Error signing out:', err);
    }
  };

  const handleExitImpersonation = async () => {
    try {
      sessionStorage.removeItem('impersonation');
      setImpersonating(false);
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      logger.error('Error exiting impersonation:', err);
      await firebaseSignOut();
    }
  };

  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;

    const unsubscribeAuth = onAuthChange(async (fbUser) => {
      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }

      try {
        if (fbUser) {
          setUser(fbUser);
          const isImpersonating = !!sessionStorage.getItem('impersonation');
          setImpersonating(isImpersonating);

          // Super admin (not impersonating): synthesize profile, skip Firestore
          if (isSuperAdminEmail(fbUser.email) && !isImpersonating) {
            setUserProfile({
              id: fbUser.uid,
              email: fbUser.email || '',
              firstName: 'Super',
              lastName: 'Admin',
              role: 'super_admin',
              phoneNumber: '',
              isActive: true,
              createdAt: null as any,
              updatedAt: null as any,
            });
            setLoading(false);
            return;
          }

          // Normal user or impersonating: load from Firestore. When the
          // impersonation record is flagged `simulated`, the target was a
          // seeded demo user (only exists at simulation/native/users/<uid>),
          // so read from the sim collection instead of the real one — the
          // banner + the rest of the app depend on having a profile to show.
          let simProfile = false;
          try {
            const raw = sessionStorage.getItem('impersonation');
            if (raw) simProfile = !!JSON.parse(raw)?.simulated;
          } catch { /* ignore malformed flag */ }

          await new Promise(resolve => setTimeout(resolve, 100));

          const profileResponse = await userOperations.getUser(fbUser.uid, simProfile);
          if (profileResponse.success && profileResponse.data && !profileResponse.data.role) {
            logger.warn('User document missing role, retrying...');
            await new Promise(resolve => setTimeout(resolve, 200));
          }

          unsubscribeProfile = userOperations.onUserChange(
            fbUser.uid,
            (profile) => {
              setUserProfile(profile);
              setLoading(false);
            },
            simProfile,
          );
        } else {
          setUser(null);
          setUserProfile(null);
          setLoading(false);
        }
      } catch (err: any) {
        logger.error('Error fetching user profile:', err);
        setUser(fbUser);
        setUserProfile(null);
        setLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) unsubscribeProfile();
    };
  }, []);

  const value: AuthState = {
    user,
    userProfile,
    loading,
    error,
    impersonating,
    signOut: handleSignOut,
    exitImpersonation: handleExitImpersonation,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthState => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
