import {initializeApp} from 'firebase/app';
import {initializeAppCheck, ReCaptchaV3Provider} from 'firebase/app-check';
import {
    getAuth,
    connectAuthEmulator,
    GoogleAuthProvider,
    signInWithPopup,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    sendPasswordResetEmail,
    sendSignInLinkToEmail,
    isSignInWithEmailLink,
    signInWithEmailLink,
    signOut as firebaseSignOut,
    signInWithCustomToken,
    onAuthStateChanged,
    updateProfile,
    User
} from 'firebase/auth';
import {getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, serverTimestamp} from 'firebase/firestore';
import {getStorage, connectStorageEmulator} from 'firebase/storage';
import {getFunctions, connectFunctionsEmulator} from 'firebase/functions';
import {UserRole, User as AppUser} from '../types';
import logger from "./logger";
import {normalizePhoneNumber} from "./phone";
import { audit } from "./audit";

// Firebase config from environment variables
const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

let appCheck: any = null;

const recaptchaSiteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;

if (process.env.NODE_ENV === "development") {
    // Skip App Check initialization in development
} else if (!recaptchaSiteKey) {
    // Skip App Check if no reCAPTCHA site key is configured (e.g. zero-cost demo)
    logger.warn('VITE_RECAPTCHA_SITE_KEY not set — App Check disabled');
} else {
    // Only initialize App Check in production
    try {
        appCheck = initializeAppCheck(app, {
            provider: new ReCaptchaV3Provider(recaptchaSiteKey),
            isTokenAutoRefreshEnabled: true,
        });
    } catch (error) {
        logger.error('Failed to initialize App Check:', error);
    }
}

// Initialize Firebase services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Initialize Functions service. All functions are deployed to us-west1
// (see `setGlobalOptions` in functions/src/index.ts).
let functions: any = null;
try {
    functions = getFunctions(app, 'us-west1');
} catch (error) {
    logger.error('Failed to initialize Firebase Functions:', error);
}

export {functions};

// Initialize providers
export const googleProvider = new GoogleAuthProvider();

// Configure providers
googleProvider.setCustomParameters({
    prompt: 'select_account'
});

// Simple environment detection - use emulators when on localhost
const useEmulators = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

if (useEmulators) {
    try {
        // Connect to emulators - make sure functions is initialized first
        if (functions) {
            connectFunctionsEmulator(functions, 'localhost', 5001);
        }

        connectAuthEmulator(auth, 'http://localhost:9099', {disableWarnings: true});
        connectFirestoreEmulator(db, 'localhost', 8080);
        connectStorageEmulator(storage, 'localhost', 9199);
    } catch (error) {
        logger.warn('Emulators already connected or not available:', error);
    }
}

// Firebase service object with admin functions
export const firebaseService = {
    createUserWithAuth: async (userData: {
        email: string;
        firstName: string;
        lastName: string;
        role: string;
        phoneNumber?: string;
        sendWelcomeSms?: boolean;
    }) => {
        try {
            const {httpsCallable} = await import('firebase/functions');
            const createUser = httpsCallable(functions, 'createUserWithAuth');

            const result = await createUser(userData);
            return result.data;
        } catch (error: any) {
            logger.error('Error creating user with auth:', error);
            throw error;
        }
    },

    updateUserAuth: async (uid: string, userData: {
        email?: string;
        firstName?: string;
        lastName?: string;
        role?: string;
        isActive?: boolean;
    }) => {
        try {
            const {httpsCallable} = await import('firebase/functions');
            const updateUser = httpsCallable(functions, 'updateUserAuth');

            const result = await updateUser({uid, ...userData});
            return result.data;
        } catch (error: any) {
            logger.error('Error updating user auth:', error);
            throw error;
        }
    },

    setUserPassword: async (uid: string, password: string) => {
        try {
            const {httpsCallable} = await import('firebase/functions');
            const fn = httpsCallable(functions, 'setUserPassword');
            const result = await fn({uid, password});
            return result.data as { success: boolean; error?: string; message?: string };
        } catch (error: any) {
            // Password intentionally not logged.
            logger.error('Error setting user password:', { code: error.code, message: error.message });
            throw error;
        }
    },
};

// Helper function to create user document in Firestore.
//
// Registration gate: when this is a new user (first sign-in via email/Google),
// we check `system/settings.registrationEnabled` BEFORE writing the doc. If
// registration is disabled, we delete the just-created Firebase Auth user and
// throw — preventing self-signup even if a determined client bypasses the UI
// gates. This is the single chokepoint for all new-user creation outside of
// admin-created users (`createUserWithAuth`) and phone OTP (gated server-side
// in `verifyPhoneLogin`).
const createUserDocument = async (user: User, additionalData: Partial<AppUser> = {}, isNewUser: boolean = false) => {
    if (!user) return;

    if (isNewUser) {
        try {
            const settingsSnap = await getDoc(doc(db, 'system', 'settings'));
            const settings = settingsSnap.exists() ? settingsSnap.data() : {};
            // Default is closed: if doc missing OR field missing, registration is OFF.
            const registrationEnabled = settings?.registrationEnabled === true;
            if (!registrationEnabled) {
                // Roll back the auth user we just created so we don't leak orphan accounts
                try {
                    await user.delete();
                } catch (deleteErr) {
                    logger.warn('Failed to delete auth user after blocked registration:', deleteErr);
                }
                throw new Error('REGISTRATION_DISABLED');
            }
        } catch (gateError: any) {
            if (gateError.message === 'REGISTRATION_DISABLED') throw gateError;
            // If the settings doc read failed for any other reason, fall through —
            // we don't want a transient Firestore error to lock everyone out.
            logger.warn('Could not read app settings during registration check:', gateError);
        }
    }

    const userRef = doc(db, 'users', user.uid);

    // Build user data object and filter out undefined values
    const baseUserData: any = {
        email: user.email || '',
        firstName: additionalData.firstName || user.displayName?.split(' ')[0] || '',
        lastName: additionalData.lastName || user.displayName?.split(' ').slice(1).join(' ') || '',
        emailVerified: user.emailVerified,
        updatedAt: serverTimestamp(),
        lastLoginAt: serverTimestamp(),
    };

    // Only set role and createdAt for new users, don't overwrite existing role on login
    if (isNewUser) {
        baseUserData.role = 'patient';
        baseUserData.isActive = false;
        baseUserData.createdAt = serverTimestamp();
        baseUserData.phoneNumber = normalizePhoneNumber(user.phoneNumber || additionalData.phoneNumber || '');
    }
    
    // Add any additional data, filtering out undefined values
    const filteredAdditionalData = Object.fromEntries(
        Object.entries(additionalData).filter(([_, value]) => value !== undefined)
    );

    const userData = {...baseUserData, ...filteredAdditionalData};

    try {
        await setDoc(userRef, userData, {merge: true});
    } catch (error) {
        logger.error('Error creating user document:', error);
        throw error;
    }
};

// Enhanced auth helper functions
export const signInWithGoogle = async () => {
    try {
        const result = await signInWithPopup(auth, googleProvider);
        const isNewUser = result.user.metadata.creationTime === result.user.metadata.lastSignInTime;
        await createUserDocument(result.user, {}, isNewUser);
        audit({ action: isNewUser ? 'auth.signup' : 'auth.login', metadata: { method: 'google' } });
        return result;
    } catch (error) {
        logger.error('Google sign in error:', error);
        throw error;
    }
};


export const signUpWithEmail = async (
    email: string,
    password: string,
    additionalData: {
        firstName: string;
        lastName: string;
        phoneNumber: string;
        role?: UserRole
    }
) => {
    try {
        const result = await createUserWithEmailAndPassword(auth, email, password);

        // Update the user's display name in Firebase Auth
        const displayName = `${additionalData.firstName} ${additionalData.lastName}`;
        await updateProfile(result.user, {displayName});

        // Send email verification
        await sendEmailVerification(result.user);

        // Create user document with additional data
        await createUserDocument(result.user, {
            ...additionalData,
        }, true); // true indicates this is a new user

        audit({ action: 'auth.signup', metadata: { method: 'email' } });
        return result;
    } catch (error) {
        logger.error('Email signup error:', error);
        throw error;
    }
};

// Email verification functions
export const sendEmailVerification = async (user?: User) => {
    try {
        const {sendEmailVerification: firebaseSendEmailVerification} = await import('firebase/auth');
        const currentUser = user || auth.currentUser;

        if (!currentUser) {
            throw new Error('No user is currently signed in');
        }

        if (currentUser.emailVerified) {
            throw new Error('Email is already verified');
        }

        await firebaseSendEmailVerification(currentUser);
        return {success: true, message: 'Email verification sent successfully'};
    } catch (error: any) {
        logger.error('Error sending email verification:', error);
        throw error;
    }
};

export const checkEmailVerified = async () => {
    try {
        const currentUser = auth.currentUser;
        if (!currentUser) {
            return {verified: false, error: 'No user signed in'};
        }

        // Reload user to get latest email verification status
        await currentUser.reload();
        return {verified: currentUser.emailVerified};
    } catch (error: any) {
        logger.error('Error checking email verification:', error);
        return {verified: false, error: error.message};
    }
};

export const resendEmailVerification = async () => {
    try {
        const currentUser = auth.currentUser;
        if (!currentUser) {
            throw new Error('No user is currently signed in');
        }

        if (currentUser.emailVerified) {
            throw new Error('Email is already verified');
        }

        const {sendEmailVerification: firebaseSendEmailVerification} = await import('firebase/auth');
        await firebaseSendEmailVerification(currentUser);
        return {success: true, message: 'Email verification sent successfully'};
    } catch (error: any) {
        logger.error('Error resending email verification:', error);
        throw error;
    }
};

export const signInWithEmail = async (email: string, password: string) => {
    try {
        const result = await signInWithEmailAndPassword(auth, email, password);

        await createUserDocument(result.user, {
            lastLoginAt: serverTimestamp() as any,
        }, false);

        audit({ action: 'auth.login', metadata: { method: 'email' } });
        return result;
    } catch (error) {
        logger.error('Email sign in error:', error);
        throw error;
    }
};

export const resetPassword = async (email: string) => {
    try {
        await sendPasswordResetEmail(auth, email);
        return {success: true};
    } catch (error: any) {
        logger.error('Password reset error:', error);
        throw error;
    }
};

// Phone OTP login helpers
export const sendPhoneLoginCode = async (phoneNumber: string) => {
    const { httpsCallable } = await import('firebase/functions');
    const fn = httpsCallable(functions, 'sendPhoneLoginCode');
    const result = await fn({ phoneNumber });
    return result.data as { success: boolean; message?: string; error?: string };
};

export const verifyPhoneLogin = async (
    phoneNumber: string,
    code: string,
    firstName?: string,
    lastName?: string,
) => {
    const { httpsCallable } = await import('firebase/functions');
    const fn = httpsCallable(functions, 'verifyPhoneLogin');
    const result = await fn({ phoneNumber, code, firstName, lastName });
    const data = result.data as {
        success: boolean;
        token?: string;
        isNewUser?: boolean;
        needsName?: boolean;
        error?: string;
    };

    if (data.success && data.token) {
        await signInWithCustomToken(auth, data.token);
        audit({ action: 'auth.login', metadata: { method: 'phone' } });
    }

    return data;
};

// Email Link Authentication Functions
export const sendLoginLink = async (email: string) => {
    try {
        // sendSignInLinkToEmail requires actionCodeSettings
        const actionCodeSettings = {
            url: window.location.origin + '/auth',
            handleCodeInApp: true,
        };

        await sendSignInLinkToEmail(auth, email, actionCodeSettings);

        // Store email in localStorage to complete sign-in later
        window.sessionStorage.setItem('emailForSignIn', email);

        return {success: true};
    } catch (error: any) {
        logger.error('Send login link error:', error);
        throw error;
    }
};

/**
 * Send a sign-in invite link to a different user (admin invite flow).
 *
 * Unlike `sendLoginLink`, this does NOT stash the email in sessionStorage,
 * because the recipient will open the link in a different browser. The
 * recipient will be prompted to confirm their email by `AuthPage`'s
 * `needsEmailForLink` flow when they click the link.
 *
 * Uses the same Firebase email-link infrastructure (no external SMTP).
 * The email content is configured in Firebase Console → Authentication →
 * Templates → "Email address sign-in".
 */
export const sendInviteLink = async (email: string) => {
    try {
        const actionCodeSettings = {
            url: window.location.origin + '/auth',
            handleCodeInApp: true,
        };
        await sendSignInLinkToEmail(auth, email, actionCodeSettings);
        return { success: true };
    } catch (error: any) {
        logger.error('Send invite link error:', error);
        throw error;
    }
};

/**
 * Check if we have a stored email for sign-in link completion.
 * Returns the email if found, null if user must provide it.
 */
export const getStoredEmailForSignIn = (): string | null => {
    return window.sessionStorage.getItem('emailForSignIn');
};

export const completeEmailLinkSignIn = async (email?: string, emailLink?: string) => {
    try {
        const url = emailLink || window.location.href;

        if (!isSignInWithEmailLink(auth, url)) {
            throw new Error('Invalid sign-in link. Please request a new one.');
        }

        // Use provided email or get from sessionStorage
        const resolvedEmail = email || window.sessionStorage.getItem('emailForSignIn');

        if (!resolvedEmail) {
            throw new Error('EMAIL_REQUIRED');
        }

        const result = await signInWithEmailLink(auth, resolvedEmail, url);

        // Clean up sessionStorage
        window.sessionStorage.removeItem('emailForSignIn');

        // Create/update user document
        const isNewUser = result.user.metadata.creationTime === result.user.metadata.lastSignInTime;

        await createUserDocument(result.user, {}, isNewUser);

        audit({ action: isNewUser ? 'auth.signup' : 'auth.login', metadata: { method: 'email_link' } });
        return result;
    } catch (error: any) {
        logger.error('Complete email link sign-in error:', error);
        throw error;
    }
};

export const isValidEmailLink = (url?: string) => {
    return isSignInWithEmailLink(auth, url || window.location.href);
};

export const signOut = () => firebaseSignOut(auth);

export const onAuthChange = (callback: (user: User | null) => void) =>
    onAuthStateChanged(auth, callback);

// Export user document creation helper
export {createUserDocument};
export {appCheck};
export default app;
