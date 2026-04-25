/**
 * Data layer for the `client-errors` collection — browser-side errors and
 * warnings forwarded from the web app, viewable by super-admins. Keep raw
 * Firestore calls out of pages by routing them through this module.
 */

import { collection, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import type { ApiResponse } from '../../types';
import logger from '../logger';

const collectionRef = collection(db, 'client-errors');

export const clientErrorsOperations = {
  async deleteError(id: string): Promise<ApiResponse<void>> {
    try {
      await deleteDoc(doc(collectionRef, id));
      return { success: true };
    } catch (err: unknown) {
      logger.error('Failed to delete client-error doc:', err);
      return { success: false, error: 'Failed to delete error' };
    }
  },
};
