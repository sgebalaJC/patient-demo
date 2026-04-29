import {
  query,
  orderBy,
  onSnapshot,
  where,
  doc,
  updateDoc,
  arrayUnion,
  serverTimestamp,
  getDoc,
  getDocs,
  Unsubscribe,
} from 'firebase/firestore';
import { collections, mapDocStrict } from './base';
import { audit } from '../audit';
import type {
  PriorAuth,
  PayerPolicy,
  Payer,
  TargetCpt,
  CriteriaChecklistItem,
} from '../../types/prior-auth';

export function subscribeToPriorAuth(
  paId: string,
  onChange: (pa: PriorAuth | null) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    doc(collections.priorAuths, paId),
    (snap) => onChange(snap.exists() ? ({ id: snap.id, ...(snap.data() as Omit<PriorAuth, 'id'>) }) : null),
    (err) => onError(err as Error),
  );
}

// Local writes for fields the coordinator can edit inline (notes, checklist
// tweaks, attachments). Status transitions go through the callable so the
// state machine is enforced server-side.

export async function appendNote(
  paId: string,
  authorId: string,
  authorName: string,
  text: string,
): Promise<void> {
  await updateDoc(doc(collections.priorAuths, paId), {
    notes: arrayUnion({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      authorId,
      authorName,
      text,
      createdAt: new Date(),
    }),
    updatedAt: serverTimestamp(),
  });
  audit({ action: 'prior_auth.note_added', resourceType: 'prior-auth', resourceId: paId, metadata: { authorId } });
}

export async function updateChecklist(
  paId: string,
  checklist: CriteriaChecklistItem[],
): Promise<void> {
  await updateDoc(doc(collections.priorAuths, paId), {
    criteriaChecklist: checklist,
    updatedAt: serverTimestamp(),
  });
  audit({ action: 'prior_auth.checklist_updated', resourceType: 'prior-auth', resourceId: paId });
}

// Policies library — list + per-policy snapshots -----------------------------

const PAYER_REQUIRED: ReadonlyArray<keyof Payer> = ['name', 'type', 'active'];
const POLICY_REQUIRED: ReadonlyArray<keyof PayerPolicy> = ['payerId'];
const CPT_REQUIRED: ReadonlyArray<keyof TargetCpt> = ['cptCode'];

export function subscribeToPayers(
  onChange: (rows: Payer[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(collections.payers, orderBy('name')),
    (snap) =>
      onChange(
        snap.docs
          .map((d) => mapDocStrict<Payer>(d, PAYER_REQUIRED, 'payers'))
          .filter((p): p is Payer => p !== null),
      ),
    (err) => onError(err as Error),
  );
}

export function subscribeToPoliciesByPayer(
  payerId: string,
  onChange: (rows: PayerPolicy[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(collections.payerPolicies, where('payerId', '==', payerId)),
    (snap) =>
      onChange(
        snap.docs
          .map((d) => mapDocStrict<PayerPolicy>(d, POLICY_REQUIRED, 'payer-policies'))
          .filter((p): p is PayerPolicy => p !== null),
      ),
    (err) => onError(err as Error),
  );
}

export async function getPolicy(policyId: string): Promise<PayerPolicy | null> {
  const snap = await getDoc(doc(collections.payerPolicies, policyId));
  return mapDocStrict<PayerPolicy>(snap, POLICY_REQUIRED, 'payer-policies');
}

export async function listTargetCpts(): Promise<TargetCpt[]> {
  const snap = await getDocs(query(collections.targetCpts, orderBy('cptCode')));
  return snap.docs
    .map((d) => mapDocStrict<TargetCpt>(d, CPT_REQUIRED, 'target-cpts'))
    .filter((c): c is TargetCpt => c !== null);
}

export async function listPayersOnce(): Promise<Payer[]> {
  const snap = await getDocs(query(collections.payers, orderBy('name')));
  return snap.docs
    .map((d) => mapDocStrict<Payer>(d, PAYER_REQUIRED, 'payers'))
    .filter((p): p is Payer => p !== null);
}
