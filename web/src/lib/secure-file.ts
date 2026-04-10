import { auth } from './firebase';

/**
 * Get a short-lived signed URL for a file via the serveFile Cloud Function.
 * The function verifies the user has access before returning the URL.
 *
 * @param storagePath - The Cloud Storage path (e.g., "patients/uid/documents/file.pdf")
 * @returns A signed URL valid for 15 minutes, or null on failure
 */
export async function getSecureFileUrl(storagePath: string): Promise<string | null> {
  try {
    const user = auth.currentUser;
    if (!user) return null;

    const idToken = await user.getIdToken();

    // Determine the function URL based on environment
    const isEmulator = window.location.hostname === 'localhost';
    const baseUrl = isEmulator
      ? 'http://localhost:5001/YOUR_FIREBASE_PROJECT/us-central1/serveFile'
      : 'https://us-central1-YOUR_FIREBASE_PROJECT.cloudfunctions.net/serveFile';

    const response = await fetch(
      `${baseUrl}?path=${encodeURIComponent(storagePath)}`,
      {
        headers: {
          'Authorization': `Bearer ${idToken}`,
        },
      }
    );

    if (!response.ok) return null;

    const data = await response.json();
    return data.url || null;
  } catch {
    return null;
  }
}

/**
 * Extract the Cloud Storage path from a Firebase download URL.
 * Firebase URLs encode the path in the URL between /o/ and ?
 */
export function extractStoragePath(downloadUrl: string): string | null {
  try {
    const url = new URL(downloadUrl);
    const pathMatch = url.pathname.match(/\/o\/(.+)/);
    if (pathMatch) {
      return decodeURIComponent(pathMatch[1]);
    }
    return null;
  } catch {
    return null;
  }
}
