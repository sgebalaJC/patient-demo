import {
  doc,
  getDocs,
  setDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { collections } from './base';
import { TodoItem, ApiResponse } from '../../types';
import logger from '../logger';

export const todoOperations = {
  // Create todo item
  async createTodo(todoData: Omit<TodoItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<ApiResponse<TodoItem>> {
    try {
      const todoId = `todo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const todoRef = doc(collections.todos, todoId);

      const newTodo: TodoItem = {
        id: todoId,
        ...todoData,
        createdAt: serverTimestamp() as Timestamp,
        updatedAt: serverTimestamp() as Timestamp,
      };

      await setDoc(todoRef, newTodo);
      return { success: true, data: newTodo };
    } catch (error: any) {
      logger.error('Error creating todo:', error);
      return { success: false, error: error.message };
    }
  },

  // Get todos for admin with pagination
  async getAdminTodos(
    limitParam: number = 5,
    page: number = 1,
    filter: 'all' | 'upcoming' | 'overdue' | 'completed' = 'all'
  ): Promise<ApiResponse<{
    todos: TodoItem[],
    total: number,
    hasMore: boolean,
    currentPage: number,
        statusCounts: {
            all: number,
            upcoming: number,
            overdue: number,
            completed: number
        }
    }>> {
        try {
            // First get total count and calculate status counts for all documents
            const countQuery = query(
                collections.todos,
                where('isActive', '==', true)
            );
            const countSnapshot = await getDocs(countQuery);
            const total = countSnapshot.size;

            // If no todos found, return early
            if (total === 0) {
                return {
                    success: true,
                    data: {
                        todos: [],
                        total: 0,
                        hasMore: false,
                        currentPage: page,
                        statusCounts: { all: 0, upcoming: 0, overdue: 0, completed: 0 }
                    }
                };
            }

            // Helper function to safely convert to Date
            const toSafeDate = (dateValue: any): Date => {
                if (!dateValue) return new Date();

                // If it's a Firestore Timestamp
                if (dateValue.toDate && typeof dateValue.toDate === 'function') {
                    return dateValue.toDate();
                }

                // If it's already a Date
                if (dateValue instanceof Date) {
                    return dateValue;
                }

                // If it's a string or number, try to parse
                return new Date(dateValue);
            };

            // Calculate status counts from all documents (not just paginated results)
            const allTodosForCounts = countSnapshot.docs.map(doc => {
                const data = doc.data();
                return { id: doc.id, ...data } as TodoItem;
            });

            const nowForCounts = new Date();

            let statusCounts = {
                all: allTodosForCounts.length,
                upcoming: 0,
                overdue: 0,
                completed: 0
            };

            // Calculate counts with error handling
            try {
                statusCounts.upcoming = allTodosForCounts.filter(t => {
                    try {
                        const scheduleDate = toSafeDate(t.scheduledDateTime);
                        return !t.isCompleted && scheduleDate >= nowForCounts;
                    } catch {
                        return false;
                    }
                }).length;

                statusCounts.overdue = allTodosForCounts.filter(t => {
                    try {
                        const scheduleDate = toSafeDate(t.scheduledDateTime);
                        return !t.isCompleted && scheduleDate < nowForCounts;
                    } catch {
                        return false;
                    }
                }).length;

                statusCounts.completed = allTodosForCounts.filter(t => t.isCompleted).length;
            } catch (error) {
                logger.error('Error calculating status counts:', error);
                statusCounts = { all: allTodosForCounts.length, upcoming: 0, overdue: 0, completed: 0 };
            }

            // Get all todos for this admin, sorted by scheduled date (most recent/urgent first)
            let todosQuery = query(
                collections.todos,
                where('isActive', '==', true),
                orderBy('scheduledDateTime', 'desc')
            );

            const snapshot = await getDocs(todosQuery);

            // Map all documents
            let allTodos = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            } as TodoItem));

            // Apply server-side filtering in memory with error handling
            let filteredTodos = allTodos;
            const nowForFilter = new Date();

            try {
                switch (filter) {
                    case 'upcoming':
                        filteredTodos = allTodos.filter(t => {
                            try {
                                const scheduleDate = toSafeDate(t.scheduledDateTime);
                                return !t.isCompleted && scheduleDate >= nowForFilter;
                            } catch {
                                return false;
                            }
                        });
                        break;
                    case 'overdue':
                        filteredTodos = allTodos.filter(t => {
                            try {
                                const scheduleDate = toSafeDate(t.scheduledDateTime);
                                return !t.isCompleted && scheduleDate < nowForFilter;
                            } catch {
                                return false;
                            }
                        });
                        break;
                    case 'completed':
                        filteredTodos = allTodos.filter(t => t.isCompleted);
                        break;
                    case 'all':
                    default:
                        break;
                }
            } catch (error) {
                logger.error('Error during filtering, using all todos:', error);
                filteredTodos = allTodos;
            }

            // Apply offset-based pagination to filtered results (more reliable than cursor-based)
            const startIndex = (page - 1) * limitParam;
            const endIndex = startIndex + limitParam;
            const paginatedTodos = filteredTodos.slice(startIndex, endIndex);
            const hasMore = endIndex < filteredTodos.length;

            const todos = paginatedTodos;

            return {
                success: true,
                data: {
                    todos: todos,
                    total,
                    hasMore,
                    statusCounts,
                    currentPage: page
                }
            };
        } catch (error: any) {
            logger.error('Error getting admin todos:', error);
            return { success: false, error: error.message };
        }
    },

  // Update todo
  async updateTodo(todoId: string, updates: Partial<TodoItem>): Promise<ApiResponse<void>> {
    try {
      const todoRef = doc(collections.todos, todoId);
      await updateDoc(todoRef, {
        ...updates,
        updatedAt: serverTimestamp(),
      });

      return { success: true };
    } catch (error: any) {
      logger.error('Error updating todo:', error);
      return { success: false, error: error.message };
    }
  },

  // Delete todo (soft delete)
  async deleteTodo(todoId: string): Promise<ApiResponse<void>> {
    try {
      const todoRef = doc(collections.todos, todoId);
      await updateDoc(todoRef, {
        isActive: false,
        updatedAt: serverTimestamp(),
      });

      return { success: true };
    } catch (error: any) {
      logger.error('Error deleting todo:', error);
      return { success: false, error: error.message };
    }
  },

  // Get pending reminders (for Cloud Function)
  async getPendingReminders(): Promise<ApiResponse<TodoItem[]>> {
    try {
      const now = new Date();
      const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);

      const todosQuery = query(
        collections.todos,
        where('isActive', '==', true),
        where('isCompleted', '==', false),
        where('isReminderSent', '==', false),
        where('scheduledDateTime', '<=', Timestamp.fromDate(now)),
        where('scheduledDateTime', '>=', Timestamp.fromDate(thirtyMinutesAgo))
      );

      const snapshot = await getDocs(todosQuery);
      const todos = snapshot.docs.map(doc => ({ ...doc.data() } as TodoItem));

      return { success: true, data: todos };
    } catch (error: any) {
      logger.error('Error getting pending reminders:', error);
      return { success: false, error: error.message };
    }
  },

  // Mark reminder as sent
  async markReminderSent(todoId: string): Promise<ApiResponse<void>> {
    try {
      const todoRef = doc(collections.todos, todoId);
      await updateDoc(todoRef, {
        isReminderSent: true,
        reminderSentAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      return { success: true };
    } catch (error: any) {
      logger.error('Error marking reminder sent:', error);
      return { success: false, error: error.message };
    }
  },
};
