import React, { useState, useEffect } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { todoOperations } from '../lib/firestore';
import { TodoItem } from '../types';
import { useAuth } from '../hooks/useAuth';
import {
    CheckSquare,
    Plus,
    Edit,
    Trash2,
    Clock,
    AlertTriangle,
    Calendar,
    Bell,
    CheckCircle2,
    Square,
} from 'lucide-react';
import { TodoForm } from '../components/admin/TodoForm';
import { Timestamp } from 'firebase/firestore';
import { formatDateTime } from '../lib/date-helpers';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { AccessDenied } from '../components/ui/AccessDenied';
import { PageHeader } from '../components/ui/PageHeader';
import { StatsGrid } from '../components/ui/StatsGrid';
import { FilterTabs } from '../components/ui/FilterTabs';
import { EmptyState } from '../components/ui/EmptyState';
import { PaginationBar } from '../components/ui/PaginationBar';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { StatusBadge } from '../components/ui/StatusBadge';
import { getPriorityBadgeColor, getPriorityIcon } from '../lib/status-helpers';
export const AdminTodoPage: React.FC = () => {
  const { user, userProfile, loading: authLoading } = useAuth();
  const [allTodos, setAllTodos] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingTodo, setEditingTodo] = useState<TodoItem | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const [filter, setFilter] = useState<'all' | 'upcoming' | 'overdue' | 'completed'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 5;
  const [statusCounts, setStatusCounts] = useState({
    all: 0,
    upcoming: 0,
    overdue: 0,
    completed: 0,
  });

  // Load all data once, re-load on refresh trigger
  useEffect(() => {
    if (user && userProfile?.role === 'admin') {
      loadAllTodos();
    }
  }, [user, userProfile, refreshTrigger]);

  // Reset page on filter change (no re-fetch)
  useEffect(() => { setCurrentPage(1); }, [filter]);

  const loadAllTodos = async () => {
    if (!user) return;

    setLoading(true);
    try {
      const response = await todoOperations.getAdminTodos(1000, 1, 'all');

      if (response.success && response.data) {
        setAllTodos(response.data.todos);

        if (response.data.statusCounts) {
          setStatusCounts(response.data.statusCounts);
        }
      } else {
        setAllTodos([]);
      }
    } catch (error) {
      setAllTodos([]);
    } finally {
      setLoading(false);
    }
  };

  // Client-side filter + paginate
  const filterTodo = (todo: TodoItem) => {
    if (filter === 'all') return true;
    const now = new Date();
    if (filter === 'completed') return todo.isCompleted;
    if (filter === 'overdue') return !todo.isCompleted && todo.scheduledDateTime.toDate() < now;
    if (filter === 'upcoming') return !todo.isCompleted && todo.scheduledDateTime.toDate() >= now;
    return true;
  };

  const filtered = allTodos.filter(filterTodo);
  const todos = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const totalItems = filtered.length;
  const hasNextPage = currentPage * pageSize < totalItems;

  // Removed separate currentPage useEffect since pagination is now handled directly by button clicks

  const handleAddTodo = () => {
    setEditingTodo(null);
    setIsFormOpen(true);
  };

  const handleEditTodo = (todo: TodoItem) => {
    setEditingTodo(todo);
    setIsFormOpen(true);
  };

  const handleToggleComplete = async (todo: TodoItem) => {
    const response = await todoOperations.updateTodo(todo.id, {
      isCompleted: !todo.isCompleted
    });

    if (response.success) {
      setRefreshTrigger(prev => prev + 1);
    }
  };

  const handleDeleteTodo = async (todoId: string) => {
    const response = await todoOperations.deleteTodo(todoId);
    if (response.success) {
      setRefreshTrigger(prev => prev + 1);
    }
    setDeleteConfirmId(null);
  };

    const handleFormSuccess = () => {
        setCurrentPage(1);
        setRefreshTrigger(prev => prev + 1);
        setIsFormOpen(false);
        setEditingTodo(null);
    };

  const handleFormClose = () => {
    setIsFormOpen(false);
    setEditingTodo(null);
  };

  const isOverdue = (scheduledDateTime: Timestamp, isCompleted: boolean) => {
    if (isCompleted) return false;
    return scheduledDateTime.toDate() < new Date();
  };

  const counts = statusCounts;

  if (authLoading || (loading && allTodos.length === 0)) {
    return <LoadingSpinner />;
  }

  if (userProfile?.role !== 'admin') {
    return <AccessDenied message="You don't have permission to access the todo list." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        backTo="/admin"
        icon={CheckSquare}
        title="To-Do List"
        action={
          <Button onClick={handleAddTodo} className="flex items-center justify-center w-full sm:w-auto" size="md">
            <Plus className="h-4 w-4 sm:h-5 sm:w-5 mr-2" />
            Add
          </Button>
        }
      />

      <StatsGrid items={[
        { icon: CheckSquare, iconColor: 'bg-primary-100 text-primary-600', label: 'Total Tasks', value: counts.all },
        { icon: Clock, iconColor: 'bg-yellow-100 text-yellow-600', label: 'Upcoming', value: counts.upcoming },
        { icon: CheckCircle2, iconColor: 'bg-green-100 text-green-600', label: 'Completed', value: counts.completed },
        { icon: AlertTriangle, iconColor: 'bg-red-100 text-red-600', label: 'Overdue', value: counts.overdue },
      ]} />

      <FilterTabs
        tabs={[
          { key: 'all', label: 'All', count: counts.all },
          { key: 'upcoming', label: 'Upcoming', count: counts.upcoming },
          { key: 'overdue', label: 'Overdue', count: counts.overdue },
          { key: 'completed', label: 'Completed', count: counts.completed },
        ]}
        activeKey={filter}
        onChange={(key) => setFilter(key as typeof filter)}
      />

      {/* Filtered Tasks */}
      <div className={`transition-opacity duration-150 ${loading ? 'opacity-50 pointer-events-none' : ''}`}>
      {todos.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-secondary-900">
            {filter === 'all' && 'All Tasks'}
            {filter === 'upcoming' && 'Upcoming Tasks'}
            {filter === 'overdue' && 'Overdue Tasks'}
            {filter === 'completed' && 'Completed Tasks'}
          </h2>
          <div className="space-y-3">
            {todos.map((todo: TodoItem) => {
              const PriorityIcon = getPriorityIcon(todo.priority);
              const overdue = isOverdue(todo.scheduledDateTime, todo.isCompleted);

              return (
                <Card key={todo.id} className={`p-4 ${overdue ? 'border-red-200 bg-red-50' : todo.isCompleted ? 'border-green-200 bg-green-50' : ''}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-start space-x-4 flex-1">
                      <button
                        onClick={() => handleToggleComplete(todo)}
                        className={`mt-1 ${todo.isCompleted ? 'text-green-600 hover:text-green-700' : 'text-secondary-400 hover:text-primary-600'}`}
                      >
                        {todo.isCompleted ? <CheckCircle2 className="h-5 w-5" /> : <Square className="h-5 w-5" />}
                      </button>

                      <div className="flex-1">
                        <div className="flex items-center space-x-2 mb-2">
                          <h3 className={`font-semibold ${todo.isCompleted ? 'text-secondary-600 line-through' : 'text-secondary-900'}`}>{todo.title}</h3>
                          <StatusBadge
                            label={todo.priority}
                            colorClass={getPriorityBadgeColor(todo.priority)}
                            icon={<PriorityIcon className="h-3 w-3 mr-1" />}
                          />
                          {todo.isReminderSent && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                              <Bell className="h-3 w-3 mr-1" />
                              Reminded
                            </span>
                          )}
                          {overdue && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              Overdue
                            </span>
                          )}
                        </div>

                        {todo.description && (
                          <p className={`text-sm mb-2 ${todo.isCompleted ? 'text-secondary-500 line-through' : 'text-secondary-600'}`}>{todo.description}</p>
                        )}

                        <div className="flex items-center text-sm text-secondary-500">
                          <Calendar className="h-4 w-4 mr-1" />
                          {formatDateTime(todo.scheduledDateTime)}
                          {todo.category && (
                            <>
                              <span className="mx-2">•</span>
                              <span>{todo.category}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      {!todo.isCompleted && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleToggleComplete(todo)}
                          className="text-green-600 hover:text-green-700 bg-green-50 hover:bg-green-100"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleEditTodo(todo)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setDeleteConfirmId(todo.id)}
                        className="text-red-600 hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {todos.length === 0 && !loading && (
        <EmptyState
          icon={CheckSquare}
          title={`No ${filter !== 'all' ? filter : ''} tasks found`}
          description={filter === 'all'
            ? "Create your first todo item to get started with task management and SMS reminders."
            : `No ${filter} tasks found. Try switching to a different filter.`
          }
          action={filter === 'all' ? (
            <Button onClick={handleAddTodo}>
              <Plus className="h-5 w-5 mr-2" />
              Add Your First Todo
            </Button>
          ) : undefined}
        />
      )}

      <PaginationBar
        currentPage={currentPage}
        pageSize={pageSize}
        totalItems={totalItems}
        hasMore={hasNextPage}
        onPreviousPage={() => setCurrentPage(currentPage - 1)}
        onNextPage={() => setCurrentPage(currentPage + 1)}
        label="todos"
      />
      </div>

      <ConfirmModal
        isOpen={!!deleteConfirmId}
        onClose={() => setDeleteConfirmId(null)}
        onConfirm={() => deleteConfirmId && handleDeleteTodo(deleteConfirmId)}
        title="Delete Todo"
        message="Are you sure you want to delete this todo item?"
        confirmLabel="Delete"
        variant="danger"
      />

      {/* Todo Form Modal */}
      <TodoForm
        isOpen={isFormOpen}
        onClose={handleFormClose}
        onSuccess={handleFormSuccess}
        editingTodo={editingTodo}
      />
    </div>
  );
};
