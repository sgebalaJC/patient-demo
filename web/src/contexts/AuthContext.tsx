import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User as FirebaseUser } from 'firebase/auth';
import { onAuthChange, signOut } from '../lib/firebase';
import { userOperations } from '../lib/firestore';
import { User as AppUser } from '../types';
import logger from '../lib/logger';
import { audit } from '../lib/audit';

export interface AuthState {
  user: FirebaseUser | null;
  userProfile: AppUser | null;
  loading: boolean;
  signOut: () => Promise<void>;
  error: string | null;
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
      audit({ action: 'auth.logout' });
      await signOut();
    } catch (error: any) {
      logger.error('Error signing out:', error);
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
