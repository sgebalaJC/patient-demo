import {
  query,
  orderBy,
  onSnapshot,
  where,
  limit,
  doc,
  updateDoc,
  arrayUnion,
  serverTimestamp,
  getDoc,
  getDocs,
  Unsubscribe,
} from 'firebase/firestore';
import { collections } from './base';
import type {
  PriorAuth,
  PriorAuthStatus,
  PayerPolicy,
  Payer,
  TargetCpt,
  CriteriaChecklistItem,
} from '../../types/prior-auth';

// List and subscribe to all PAs ordered newest first. Optional status filter
// narrows the query so coordinators can jump to e.g. "pending followup".
export function subscribeToPriorAuths(
  onChange: (rows: PriorAuth[]) => void,
  onError: (err: Error) => void,
  status?: PriorAuthStatus,
): Unsubscribe {
  const base = status
    ? query(collections.priorAuths, where('status', '==', status), orderBy('updatedAt', 'desc'), limit(200))
    : query(collections.priorAuths, orderBy('updatedAt', 'desc'), limit(200));
  return onSnapshot(
    base,
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PriorAuth, 'id'>) }))),
    (err) => onError(err as Error),
  );
}

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

export async function appendNote(paId: string, authorId: string, authorName: string, text: string): Promise<void> {
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
}

export async function updateChecklist(paId: string, checklist: CriteriaChecklistItem[]): Promise<void> {
  await updateDoc(doc(collections.priorAuths, paId), {
    criteriaChecklist: checklist,
    updatedAt: serverTimestamp(),
  });
}

// Policies library — list + per-policy snapshots -----------------------------

export function subscribeToPayers(
  onChange: (rows: Payer[]) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(collections.payers, orderBy('name')),
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Payer, 'id'>) }))),
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
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PayerPolicy, 'id'>) }))),
    (err) => onError(err as Error),
  );
}

export async function getPolicy(policyId: string): Promise<PayerPolicy | null> {
  const snap = await getDoc(doc(collections.payerPolicies, policyId));
  return snap.exists() ? ({ id: snap.id, ...(snap.data() as Omit<PayerPolicy, 'id'>) }) : null;
}

export async function listTargetCpts(): Promise<TargetCpt[]> {
  const snap = await getDocs(query(collections.targetCpts, orderBy('cptCode')));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TargetCpt, 'id'>) }));
}

export async function listPayersOnce(): Promise<Payer[]> {
  const snap = await getDocs(query(collections.payers, orderBy('name')));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Payer, 'id'>) }));
}
