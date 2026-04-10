import {
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  limit,
} from 'firebase/firestore';
import { collections } from './base';
import { AgentWorkflow, WorkflowRun, ApiResponse } from '../../types';
import logger from '../logger';

export const workflowOperations = {
  async getWorkflows(): Promise<ApiResponse<AgentWorkflow[]>> {
    try {
      const q = query(collections.agentWorkflows, orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      const workflows = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as AgentWorkflow));
      return { success: true, data: workflows };
    } catch (error: any) {
      logger.error('Error getting workflows:', error);
      return { success: false, error: error.message };
    }
  },

  async getWorkflow(id: string): Promise<ApiResponse<AgentWorkflow>> {
    try {
      const docRef = doc(collections.agentWorkflows, id);
      const snapshot = await getDoc(docRef);
      if (!snapshot.exists()) return { success: false, error: 'Workflow not found' };
      return { success: true, data: { id: snapshot.id, ...snapshot.data() } as AgentWorkflow };
    } catch (error: any) {
      logger.error('Error getting workflow:', error);
      return { success: false, error: error.message };
    }
  },

  async createWorkflow(data: Omit<AgentWorkflow, 'id' | 'createdAt' | 'updatedAt'>): Promise<ApiResponse<string>> {
    try {
      const docRef = await addDoc(collections.agentWorkflows, {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return { success: true, data: docRef.id };
    } catch (error: any) {
      logger.error('Error creating workflow:', error);
      return { success: false, error: error.message };
    }
  },

  async updateWorkflow(id: string, data: Partial<AgentWorkflow>): Promise<ApiResponse<boolean>> {
    try {
      const docRef = doc(collections.agentWorkflows, id);
      const { id: _, createdAt, ...updates } = data as any;
      await updateDoc(docRef, { ...updates, updatedAt: serverTimestamp() });
      return { success: true, data: true };
    } catch (error: any) {
      logger.error('Error updating workflow:', error);
      return { success: false, error: error.message };
    }
  },

  async deleteWorkflow(id: string): Promise<ApiResponse<boolean>> {
    try {
      await deleteDoc(doc(collections.agentWorkflows, id));
      return { success: true, data: true };
    } catch (error: any) {
      logger.error('Error deleting workflow:', error);
      return { success: false, error: error.message };
    }
  },

  async toggleWorkflow(id: string, enabled: boolean): Promise<ApiResponse<boolean>> {
    try {
      const docRef = doc(collections.agentWorkflows, id);
      await updateDoc(docRef, { enabled, updatedAt: serverTimestamp() });
      return { success: true, data: true };
    } catch (error: any) {
      logger.error('Error toggling workflow:', error);
      return { success: false, error: error.message };
    }
  },

  // Workflow runs
  async getWorkflowRuns(workflowId: string, max = 5): Promise<ApiResponse<WorkflowRun[]>> {
    try {
      const q = query(
        collections.workflowRuns,
        where('workflowId', '==', workflowId),
        orderBy('startedAt', 'desc'),
        limit(max)
      );
      const snapshot = await getDocs(q);
      const runs = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as WorkflowRun));
      return { success: true, data: runs };
    } catch (error: any) {
      logger.error('Error getting workflow runs:', error);
      return { success: false, error: error.message };
    }
  },

  async createWorkflowRun(workflowId: string): Promise<ApiResponse<string>> {
    try {
      const docRef = await addDoc(collections.workflowRuns, {
        workflowId,
        status: 'running',
        startedAt: serverTimestamp(),
        stepResults: [],
      });
      return { success: true, data: docRef.id };
    } catch (error: any) {
      logger.error('Error creating workflow run:', error);
      return { success: false, error: error.message };
    }
  },

  async updateWorkflowRun(id: string, data: Partial<WorkflowRun>): Promise<ApiResponse<boolean>> {
    try {
      const docRef = doc(collections.workflowRuns, id);
      await updateDoc(docRef, data);
      return { success: true, data: true };
    } catch (error: any) {
      logger.error('Error updating workflow run:', error);
      return { success: false, error: error.message };
    }
  },
};
