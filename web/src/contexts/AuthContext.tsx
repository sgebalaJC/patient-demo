import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User as FirebaseUser } from 'firebase/auth';
import { onAuthChange, signOut as firebaseSignOut, googleProvider, auth } from '../lib/firebase';
import { signInWithCustomToken, signInWithPopup } from 'firebase/auth';
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
  const [authState, setAuthState] = useState<Omit<AuthState, 'signOut'>>({
    user: null,
    userProfile: null,
    loading: true,
    error: null,
  });

  const handleSignOut = async () => {
    try {
      sessionStorage.removeItem('impersonation');
      audit({ action: 'auth.logout' });
      await firebaseSignOut();
    } catch (error: any) {
      logger.error('Error signing out:', error);
    }
  };

  const handleExitImpersonation = async () => {
    try {
      sessionStorage.removeItem('impersonation');
      // Re-auth as super admin via Google OAuth
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      logger.error('Error exiting impersonation:', error);
      // Fallback: full sign-out
      await firebaseSignOut();
    }
  };

  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;

    const unsubscribeAuth = onAuthChange(async (user) => {
      // Clean up previous profile listener
      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }

      try {
        if (user) {
          // Super admin: synthesize profile in memory, never touch Firestore
          if (isSuperAdminEmail(user.email) && !sessionStorage.getItem('impersonation')) {
            setAuthState({
              user,
              userProfile: {
                id: user.uid,
                email: user.email || '',
                firstName: 'Super',
                lastName: 'Admin',
                role: 'super_admin',
                isActive: true,
                createdAt: null as any,
              },
              loading: false,
              error: null,
            });
            return;
          }

          // Add a small delay to let createUserDocument finish during login flow
          await new Promise(resolve => setTimeout(resolve, 100));

          // Initial fetch to check document completeness
          const profileResponse = await userOperations.getUser(user.uid);

          if (profileResponse.success && profileResponse.data && !profileResponse.data.role) {
            logger.warn('User document missing role, retrying...');
            await new Promise(resolve => setTimeout(resolve, 200));
          }

          // Set up real-time listener for user profile changes
          unsubscribeProfile = userOperations.onUserChange(user.uid, (userProfile) => {
            setAuthState({
              user,
              userProfile,
              loading: false,
              error: null,
            });
          });
        } else {
          setAuthState({
            user: null,
            userProfile: null,
            loading: false,
            error: null,
          });
        }
      } catch (error: any) {
        logger.error('Error fetching user profile:', error);
        setAuthState({
          user,
          userProfile: null,
          loading: false,
          error: null,
        });
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) {
        unsubscribeProfile();
      }
    };
  }, []);

  const value: AuthState = {
    ...authState,
    signOut: handleSignOut,
    impersonating: !!sessionStorage.getItem('impersonation'),
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
