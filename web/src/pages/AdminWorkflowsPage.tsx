import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { workflowOperations } from '../lib/firestore';
import { sidecar } from '../lib/sidecar';
import { AgentWorkflow, WorkflowStep, WorkflowRun, WorkflowStepType, WorkflowSchedule } from '../types';
import { serverTimestamp } from 'firebase/firestore';
import {
  Search,
  Lightbulb,
  Star,
  MessageSquare,
  Circle,
  X,
  GripVertical,
  ChevronDown,
  Play,
  Pencil,
  Trash2,
  Loader,
  Workflow,
} from 'lucide-react';
import { AccessDenied } from '../components/ui/AccessDenied';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { formatDateTime } from '../lib/date-helpers';
import logger from '../lib/logger';

// ── Step type definitions ──

const STEP_TYPES: { type: WorkflowStepType; label: string; icon: typeof Search; color: string }[] = [
  { type: 'run_skill', label: 'Run a Skill', icon: Star, color: 'text-amber-500' },
  { type: 'ai_task', label: 'AI Task', icon: Lightbulb, color: 'text-purple-500' },
  { type: 'send_message', label: 'Send Message', icon: MessageSquare, color: 'text-blue-500' },
  { type: 'search_web', label: 'Search Web', icon: Search, color: 'text-orange-500' },
  { type: 'wait_approval', label: 'Wait for Approval', icon: Circle, color: 'text-pink-500' },
];

const getStepMeta = (type: WorkflowStepType) =>
  STEP_TYPES.find(s => s.type === type) || STEP_TYPES[0];

const SCHEDULE_OPTIONS: { value: WorkflowSchedule; label: string }[] = [
  { value: 'manual', label: 'Manual only' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly', label: 'Weekly' },
];

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const formatScheduleText = (w: AgentWorkflow) => {
  if (w.schedule === 'manual') return 'Manual';
  const time = w.scheduleTime || '09:00';
  const [h, m] = time.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const timeStr = `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
  if (w.schedule === 'daily') return `Daily at ${timeStr}`;
  if (w.schedule === 'weekdays') return `Weekdays at ${timeStr}`;
  if (w.schedule === 'weekly') return `${DAYS_OF_WEEK[w.scheduleDayOfWeek || 0]}s at ${timeStr}`;
  return w.schedule;
};

const makeStepId = () => `step_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

// Convert workflow schedule to cron expression
function workflowToCron(schedule: WorkflowSchedule, time: string, dayOfWeek?: number): string | null {
  if (schedule === 'manual') return null;
  const [h, m] = time.split(':').map(Number);
  if (schedule === 'daily') return `${m} ${h} * * *`;
  if (schedule === 'weekdays') return `${m} ${h} * * 1-5`;
  if (schedule === 'weekly') return `${m} ${h} * * ${dayOfWeek ?? 1}`;
  return null;
}

// Build a compound message from workflow steps for the cron job
function buildWorkflowMessage(w: { name: string; steps: WorkflowStep[] }): string {
  const parts = w.steps.map((step, i) => {
    const meta = getStepMeta(step.type);
    let instruction = '';
    if (step.type === 'run_skill' && step.config.skillId) {
      instruction = `Use the ${step.config.skillId} skill. ${step.config.prompt || ''}`;
    } else if (step.type === 'search_web') {
      instruction = `Search the web for: ${step.config.prompt || ''}`;
    } else if (step.type === 'send_message') {
      instruction = `Send a message to ${step.config.recipient || 'the user'}: ${step.config.prompt || ''}`;
    } else if (step.type === 'wait_approval') {
      instruction = `Ask for confirmation: ${step.config.prompt || 'Proceed?'}`;
    } else {
      instruction = step.config.prompt || '';
    }
    const chain = step.useOutputFromPrevious && i > 0 ? ' (use the output from the previous step)' : '';
    return `Step ${i + 1} (${meta.label}): ${instruction}${chain}`;
  });
  return `Run the workflow "${w.name}" with these steps in order:\n\n${parts.join('\n\n')}`;
}

// Sync workflow schedule to OpenClaw cron
async function syncCronJob(
  workflow: AgentWorkflow,
  schedule: WorkflowSchedule,
  time: string,
  dayOfWeek?: number,
  steps?: WorkflowStep[],
): Promise<string | undefined> {
  // Delete existing cron job if any
  if (workflow.cronJobId) {
    try { await sidecar.deleteCronJob(workflow.cronJobId); } catch { /* ignore */ }
  }

  const cronExpr = workflowToCron(schedule, time, dayOfWeek);
  if (!cronExpr) return undefined; // manual — no cron needed

  try {
    const message = buildWorkflowMessage({
      name: workflow.name,
      steps: steps || workflow.steps,
    });
    const res = await sidecar.addCronJob({
      name: `workflow:${workflow.name}`,
      cron: cronExpr,
      tz: workflow.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      message,
      session: 'isolated',
      announce: true,
    });
    // Parse job ID from output (openclaw cron add prints the ID)
    const idMatch = res.output?.match(/id[:\s]+(\S+)/i) || res.output?.match(/([a-f0-9-]{36})/);
    return idMatch?.[1];
  } catch (err) {
    logger.error('Failed to sync cron job:', err);
    return undefined;
  }
}

// ── Main page ──

export const AdminWorkflowsPage: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const { user, userProfile } = useAuth();
  const [workflows, setWorkflows] = useState<AgentWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [isNew, setIsNew] = useState(false);

  useEffect(() => {
    if (user && userProfile?.role === 'admin') loadWorkflows();
  }, [user, userProfile]);

  const loadWorkflows = async () => {
    setLoading(true);
    const res = await workflowOperations.getWorkflows();
    if (res.success && res.data) setWorkflows(res.data);
    setLoading(false);
  };

  const handleNew = () => {
    setSelectedId(null);
    setIsNew(true);
    setEditing(true);
  };

  const handleSelect = (id: string) => {
    setSelectedId(id);
    setEditing(false);
    setIsNew(false);
  };

  const handleEdit = () => setEditing(true);

  const handleSaved = (id: string) => {
    loadWorkflows();
    setSelectedId(id);
    setEditing(false);
    setIsNew(false);
  };

  const handleDeleted = () => {
    loadWorkflows();
    setSelectedId(null);
    setEditing(false);
  };

  const handleCancel = () => {
    setEditing(false);
    if (isNew) setSelectedId(null);
    setIsNew(false);
  };

  if (!embedded && userProfile?.role !== 'admin') return <AccessDenied />;

  const selected = workflows.find(w => w.id === selectedId) || null;

  return (
    <div className={`flex overflow-hidden ${
      embedded ? 'h-full' : 'h-[calc(100vh-4rem)] rounded-xl border border-secondary-200'
    }`}>
      {/* Sidebar */}
      <div className="w-72 flex-shrink-0 border-r border-secondary-200 bg-surface-card flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-secondary-200">
          <span className="text-xs font-semibold text-secondary-500 uppercase tracking-wider">
            Workflows ({workflows.length})
          </span>
          <button
            onClick={handleNew}
            className="text-sm font-medium text-primary-600 hover:text-primary-700 transition-colors"
          >
            + New
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 flex justify-center"><LoadingSpinner size="sm" /></div>
          ) : workflows.length === 0 ? (
            <p className="p-4 text-sm text-secondary-400 text-center">No workflows yet</p>
          ) : (
            workflows.map(w => (
              <button
                key={w.id}
                onClick={() => handleSelect(w.id)}
                className={`w-full text-left px-4 py-3 border-b border-secondary-100 transition-colors ${
                  selectedId === w.id
                    ? 'bg-primary-50 border-l-2 border-l-primary-600'
                    : 'hover:bg-secondary-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-medium ${
                    selectedId === w.id ? 'text-primary-700' : 'text-secondary-900'
                  }`}>
                    {w.name}
                  </span>
                  {w.enabled && (
                    <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                  )}
                </div>
                <p className="text-xs text-secondary-500 mt-0.5">{formatScheduleText(w)}</p>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto bg-secondary-50/50">
        {editing ? (
          <WorkflowEditor
            workflow={isNew ? null : selected}
            onSave={handleSaved}
            onCancel={handleCancel}
          />
        ) : selected ? (
          <WorkflowView
            workflow={selected}
            onEdit={handleEdit}
            onDeleted={handleDeleted}
            onToggle={async (enabled) => {
              await workflowOperations.toggleWorkflow(selected.id, enabled);
              if (selected.schedule !== 'manual') {
                if (enabled && !selected.cronJobId) {
                  // Create cron job
                  const cronJobId = await syncCronJob(
                    selected,
                    selected.schedule,
                    selected.scheduleTime || '09:00',
                    selected.scheduleDayOfWeek,
                  );
                  if (cronJobId) {
                    await workflowOperations.updateWorkflow(selected.id, { cronJobId } as any);
                  }
                } else if (!enabled && selected.cronJobId) {
                  // Remove cron job
                  try { await sidecar.deleteCronJob(selected.cronJobId); } catch { /* ignore */ }
                  await workflowOperations.updateWorkflow(selected.id, { cronJobId: null } as any);
                }
              }
              loadWorkflows();
            }}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-secondary-400">
            <Workflow className="h-12 w-12 mb-3 opacity-40" />
            <p className="text-sm">Select a workflow or create a new one</p>
          </div>
        )}
      </div>
    </div>
  );
};

// ── View mode ──

const WorkflowView: React.FC<{
  workflow: AgentWorkflow;
  onEdit: () => void;
  onDeleted: () => void;
  onToggle: (enabled: boolean) => void;
}> = ({ workflow, onEdit, onDeleted, onToggle }) => {
  const { user } = useAuth();
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [running, setRunning] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  useEffect(() => {
    loadRuns();
  }, [workflow.id]);

  const loadRuns = async () => {
    setLoadingRuns(true);
    const res = await workflowOperations.getWorkflowRuns(workflow.id);
    if (res.success && res.data) setRuns(res.data);
    setLoadingRuns(false);
  };

  const handleRunNow = async () => {
    if (running || !user) return;
    setRunning(true);
    try {
      const runRes = await workflowOperations.createWorkflowRun(workflow.id);
      if (!runRes.success || !runRes.data) throw new Error('Failed to create run');
      const runId = runRes.data;

      const stepResults: WorkflowRun['stepResults'] = [];
      let previousOutput = '';

      for (let i = 0; i < workflow.steps.length; i++) {
        const step = workflow.steps[i];
        let stepPrompt = '';
        try {
          if (step.type === 'run_skill') {
            stepPrompt = step.config.skillId
              ? `Use the ${step.config.skillId} skill. ${step.config.prompt || ''}`
              : step.config.prompt || '';
          } else if (step.type === 'ai_task') {
            stepPrompt = step.config.prompt || '';
          } else if (step.type === 'search_web') {
            stepPrompt = `Search the web for: ${step.config.prompt || ''}`;
          } else if (step.type === 'send_message') {
            stepPrompt = `Send a message to ${step.config.recipient || 'the user'}: ${step.config.prompt || ''}`;
          } else if (step.type === 'wait_approval') {
            stepPrompt = `Confirm: ${step.config.prompt || 'Proceed with the workflow?'}`;
          }

          if (step.useOutputFromPrevious && previousOutput) {
            stepPrompt = `Context from previous step:\n${previousOutput}\n\n${stepPrompt}`;
          }

          // Prefix with workflow context so the agent knows to execute without confirmation
          const fullPrompt = `[AUTOMATED WORKFLOW — execute immediately without asking for confirmation]\n\n${stepPrompt}`;

          const response = await sidecar.chat([{ role: 'user', content: fullPrompt }]);
          previousOutput = response.content || '';
          stepResults.push({ stepIndex: i, status: 'completed', prompt: stepPrompt, output: previousOutput });
        } catch (err: any) {
          stepResults.push({ stepIndex: i, status: 'failed', prompt: stepPrompt, error: err.message });
          // Mark remaining steps as skipped
          for (let j = i + 1; j < workflow.steps.length; j++) {
            stepResults.push({ stepIndex: j, status: 'skipped' });
          }
          break;
        }
      }

      const hasFailure = stepResults.some(r => r.status === 'failed');
      await workflowOperations.updateWorkflowRun(runId, {
        status: hasFailure ? 'failed' : 'completed',
        completedAt: serverTimestamp() as any,
        stepResults,
      });

      loadRuns();
    } catch (err) {
      logger.error('Workflow run error:', err);
    } finally {
      setRunning(false);
    }
  };

  const handleDelete = async () => {
    // Delete cron job if exists
    if (workflow.cronJobId) {
      try { await sidecar.deleteCronJob(workflow.cronJobId); } catch { /* ignore */ }
    }
    await workflowOperations.deleteWorkflow(workflow.id);
    setDeleteOpen(false);
    onDeleted();
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold text-secondary-900">{workflow.name}</h1>
        <div className="flex items-center gap-2">
          {/* Toggle */}
          <button
            onClick={() => onToggle(!workflow.enabled)}
            className={`relative w-10 h-5 rounded-full transition-colors ${
              workflow.enabled ? 'bg-green-500' : 'bg-secondary-300'
            }`}
          >
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
              workflow.enabled ? 'left-5.5 translate-x-0.5' : 'left-0.5'
            }`} />
          </button>

          <button
            onClick={handleRunNow}
            disabled={running}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {running ? <Loader className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Run Now
          </button>
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-secondary-300 text-secondary-700 text-sm font-medium rounded-lg hover:bg-secondary-50 transition-colors"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
          <button
            onClick={() => setDeleteOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-red-300 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      </div>

      {workflow.description && (
        <p className="text-sm text-secondary-600 mb-1">{workflow.description}</p>
      )}
      <p className="text-sm text-secondary-500 mb-6">{formatScheduleText(workflow)}</p>

      {/* Steps */}
      <div className="space-y-0 mb-8">
        {workflow.steps.map((step, i) => {
          const meta = getStepMeta(step.type);
          const Icon = meta.icon;
          return (
            <React.Fragment key={step.id}>
              <div className="bg-surface-card border border-secondary-200 rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-secondary-400 w-4 text-right">{i + 1}</span>
                  <Icon className={`h-5 w-5 ${meta.color}`} />
                  <div>
                    <p className="text-sm font-medium text-secondary-900">{meta.label}</p>
                    <p className="text-xs text-secondary-500 mt-0.5 line-clamp-1">
                      {step.type === 'run_skill' && step.config.skillId
                        ? step.config.skillId
                        : step.config.prompt || ''}
                    </p>
                  </div>
                </div>
              </div>
              {i < workflow.steps.length - 1 && (
                <div className="flex justify-center py-1">
                  <ChevronDown className="h-4 w-4 text-secondary-300" />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Recent runs */}
      <div>
        <h3 className="text-xs font-semibold text-secondary-500 uppercase tracking-wider mb-3">
          Recent Runs
        </h3>
        {loadingRuns ? (
          <LoadingSpinner size="sm" />
        ) : runs.length === 0 ? (
          <p className="text-sm text-secondary-400">No runs yet</p>
        ) : (
          <div className="space-y-2">
            {runs.map(run => {
              const isExpanded = expandedRunId === run.id;
              return (
                <div key={run.id} className="bg-surface-card border border-secondary-200 rounded-lg overflow-hidden">
                  <button
                    onClick={() => setExpandedRunId(isExpanded ? null : run.id)}
                    className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-secondary-50 transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      {run.status === 'completed' ? (
                        <span className="w-2 h-2 rounded-full bg-green-500" />
                      ) : run.status === 'failed' ? (
                        <span className="w-2 h-2 rounded-full bg-red-500" />
                      ) : (
                        <Loader className="w-3 h-3 animate-spin text-primary-500" />
                      )}
                      <span className="text-sm text-secondary-700">
                        {run.startedAt ? formatDateTime(run.startedAt) : '—'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${
                        run.status === 'completed' ? 'text-green-600' :
                        run.status === 'failed' ? 'text-red-600' : 'text-primary-600'
                      }`}>
                        {run.status === 'completed' ? 'Completed' :
                         run.status === 'failed' ? 'Failed' : 'Running'}
                      </span>
                      <ChevronDown className={`h-4 w-4 text-secondary-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </div>
                  </button>
                  {isExpanded && run.stepResults && run.stepResults.length > 0 && (
                    <div className="border-t border-secondary-100 px-4 py-3 space-y-3">
                      {run.stepResults.map((result, i) => {
                        const step = workflow.steps[result.stepIndex];
                        const meta = step ? getStepMeta(step.type) : null;
                        const Icon = meta?.icon || Circle;
                        return (
                          <div key={i}>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-mono text-secondary-400">{result.stepIndex + 1}</span>
                              <Icon className={`h-3.5 w-3.5 ${meta?.color || 'text-secondary-400'}`} />
                              <span className="text-xs font-medium text-secondary-700">{meta?.label || 'Step'}</span>
                              <span className={`text-xs px-1.5 py-0.5 rounded ${
                                result.status === 'completed' ? 'bg-green-100 text-green-700' :
                                result.status === 'failed' ? 'bg-red-100 text-red-700' :
                                'bg-secondary-100 text-secondary-600'
                              }`}>
                                {result.status}
                              </span>
                            </div>
                            {result.prompt && (
                              <div className="ml-8 mb-1.5">
                                <p className="text-[10px] font-medium text-secondary-400 uppercase mb-1">Prompt</p>
                                <div className="p-2.5 bg-primary-50 border border-primary-100 rounded-md text-xs text-secondary-700 whitespace-pre-wrap max-h-32 overflow-y-auto">
                                  {result.prompt}
                                </div>
                              </div>
                            )}
                            {result.output && (
                              <div className="ml-8">
                                <p className="text-[10px] font-medium text-secondary-400 uppercase mb-1">Response</p>
                                <div className="p-2.5 bg-secondary-50 rounded-md text-xs text-secondary-700 whitespace-pre-wrap max-h-40 overflow-y-auto">
                                  {result.output}
                                </div>
                              </div>
                            )}
                            {result.error && (
                              <div className="ml-8">
                                <p className="text-[10px] font-medium text-red-400 uppercase mb-1">Error</p>
                                <div className="p-2.5 bg-red-50 rounded-md text-xs text-red-700 whitespace-pre-wrap">
                                  {result.error}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={deleteOpen}
        title="Delete Workflow"
        message={`Are you sure you want to delete "${workflow.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
};

// ── Edit mode ──

const WorkflowEditor: React.FC<{
  workflow: AgentWorkflow | null;
  onSave: (id: string) => void;
  onCancel: () => void;
}> = ({ workflow, onSave, onCancel }) => {
  const { user } = useAuth();
  const [name, setName] = useState(workflow?.name || '');
  const [description, setDescription] = useState(workflow?.description || '');
  const [schedule, setSchedule] = useState<WorkflowSchedule>(workflow?.schedule || 'manual');
  const [scheduleTime, setScheduleTime] = useState(workflow?.scheduleTime || '09:00');
  const [scheduleDayOfWeek, setScheduleDayOfWeek] = useState(workflow?.scheduleDayOfWeek ?? 1);
  const [steps, setSteps] = useState<WorkflowStep[]>(workflow?.steps || []);
  const [showStepPicker, setShowStepPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  // Known workspace skills — loaded instantly, no network call
  const skills = ['calendar', 'drive', 'gmail'];

  // Drag state
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  const addStep = (type: WorkflowStepType) => {
    setSteps(prev => [...prev, {
      id: makeStepId(),
      type,
      config: {},
      useOutputFromPrevious: prev.length > 0,
    }]);
    setShowStepPicker(false);
  };

  const removeStep = (index: number) => {
    setSteps(prev => prev.filter((_, i) => i !== index));
  };

  const updateStep = (index: number, updates: Partial<WorkflowStep>) => {
    setSteps(prev => prev.map((s, i) => i === index ? { ...s, ...updates } : s));
  };

  const updateStepConfig = (index: number, key: string, value: string) => {
    setSteps(prev => prev.map((s, i) =>
      i === index ? { ...s, config: { ...s.config, [key]: value } } : s
    ));
  };

  // Drag handlers
  const handleDragStart = (index: number) => {
    dragItem.current = index;
  };

  const handleDragEnter = (index: number) => {
    dragOverItem.current = index;
  };

  const handleDragEnd = () => {
    if (dragItem.current === null || dragOverItem.current === null) return;
    const items = [...steps];
    const [dragged] = items.splice(dragItem.current, 1);
    items.splice(dragOverItem.current, 0, dragged);
    setSteps(items);
    dragItem.current = null;
    dragOverItem.current = null;
  };

  const handleSave = async () => {
    if (!name.trim() || !user) return;
    setSaving(true);
    try {
      const data = {
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        schedule,
        ...(schedule !== 'manual' ? { scheduleTime } : {}),
        ...(schedule === 'weekly' ? { scheduleDayOfWeek } : {}),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        steps,
        enabled: workflow?.enabled ?? false,
        agentId: 'main',
        createdBy: user.uid,
      };

      let savedId: string;
      if (workflow) {
        await workflowOperations.updateWorkflow(workflow.id, data);
        savedId = workflow.id;
      } else {
        const res = await workflowOperations.createWorkflow(data as any);
        if (!res.success || !res.data) throw new Error('Failed to create');
        savedId = res.data;
      }

      // Sync cron job for scheduled workflows (non-blocking — don't fail the save)
      try {
        const existingWorkflow = workflow || { ...data, id: savedId, cronJobId: undefined } as any;
        const cronJobId = await syncCronJob(existingWorkflow, schedule, scheduleTime, scheduleDayOfWeek, steps);
        if (cronJobId) {
          await workflowOperations.updateWorkflow(savedId, { cronJobId } as any);
        }
      } catch (cronErr) {
        logger.error('Cron sync failed (workflow saved):', cronErr);
      }

      onSave(savedId);
    } catch (err) {
      logger.error('Error saving workflow:', err);
    } finally {
      setSaving(false);
    }
  };

  // Time picker helpers
  const [h, m] = scheduleTime.split(':').map(Number);
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const ampm = h >= 12 ? 'PM' : 'AM';

  const setTimePart = (part: 'hour' | 'minute' | 'ampm', val: string) => {
    let newH = h, newM = m;
    if (part === 'hour') {
      const v = parseInt(val);
      newH = ampm === 'PM' ? (v === 12 ? 12 : v + 12) : (v === 12 ? 0 : v);
    } else if (part === 'minute') {
      newM = parseInt(val);
    } else if (part === 'ampm') {
      if (val === 'AM' && h >= 12) newH = h - 12;
      if (val === 'PM' && h < 12) newH = h + 12;
    }
    setScheduleTime(`${newH.toString().padStart(2, '0')}:${newM.toString().padStart(2, '0')}`);
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-secondary-900">
          {workflow ? 'Edit Workflow' : 'New Workflow'}
        </h1>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-secondary-600 hover:text-secondary-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Name + Description */}
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Workflow name"
        className="w-full px-4 py-3 bg-surface-card border border-secondary-200 rounded-lg text-secondary-900 text-sm placeholder:text-secondary-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent mb-3"
      />
      <input
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="Description (optional)"
        className="w-full px-4 py-3 bg-surface-card border border-secondary-200 rounded-lg text-secondary-900 text-sm placeholder:text-secondary-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent mb-6"
      />

      {/* Schedule */}
      <div className="mb-6">
        <label className="text-xs font-semibold text-secondary-500 uppercase tracking-wider block mb-2">
          Schedule
        </label>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={schedule}
            onChange={e => setSchedule(e.target.value as WorkflowSchedule)}
            className="px-3 py-2 bg-surface-card border border-secondary-200 rounded-lg text-sm text-secondary-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {SCHEDULE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          {schedule !== 'manual' && (
            <>
              {schedule === 'weekly' && (
                <select
                  value={scheduleDayOfWeek}
                  onChange={e => setScheduleDayOfWeek(parseInt(e.target.value))}
                  className="px-3 py-2 bg-surface-card border border-secondary-200 rounded-lg text-sm text-secondary-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  {DAYS_OF_WEEK.map((d, i) => (
                    <option key={i} value={i}>{d}</option>
                  ))}
                </select>
              )}
              <span className="text-sm text-secondary-500">at</span>
              <select
                value={hour12}
                onChange={e => setTimePart('hour', e.target.value)}
                className="px-2 py-2 bg-surface-card border border-secondary-200 rounded-lg text-sm text-secondary-900 focus:outline-none focus:ring-2 focus:ring-primary-500 w-16"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map(h => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
              <span className="text-secondary-500">:</span>
              <select
                value={m}
                onChange={e => setTimePart('minute', e.target.value)}
                className="px-2 py-2 bg-surface-card border border-secondary-200 rounded-lg text-sm text-secondary-900 focus:outline-none focus:ring-2 focus:ring-primary-500 w-16"
              >
                {Array.from({ length: 12 }, (_, i) => i * 5).map(m => (
                  <option key={m} value={m}>{m.toString().padStart(2, '0')}</option>
                ))}
              </select>
              <select
                value={ampm}
                onChange={e => setTimePart('ampm', e.target.value)}
                className="px-2 py-2 bg-surface-card border border-secondary-200 rounded-lg text-sm text-secondary-900 focus:outline-none focus:ring-2 focus:ring-primary-500 w-16"
              >
                <option value="AM">AM</option>
                <option value="PM">PM</option>
              </select>
            </>
          )}
        </div>
      </div>

      {/* Steps */}
      <div>
        <label className="text-xs font-semibold text-secondary-500 uppercase tracking-wider block mb-3">
          Steps
        </label>

        {steps.length === 0 && !showStepPicker && (
          <div className="border-2 border-dashed border-secondary-200 rounded-lg p-8 text-center mb-3">
            <p className="text-sm text-secondary-400">Add your first step below</p>
          </div>
        )}

        <div className="space-y-0">
          {steps.map((step, i) => {
            const meta = getStepMeta(step.type);
            const Icon = meta.icon;
            return (
              <React.Fragment key={step.id}>
                <div
                  draggable
                  onDragStart={() => handleDragStart(i)}
                  onDragEnter={() => handleDragEnter(i)}
                  onDragEnd={handleDragEnd}
                  onDragOver={e => e.preventDefault()}
                  className="bg-surface-card border border-secondary-200 rounded-lg p-4 group"
                >
                  {/* Step header */}
                  <div className="flex items-center gap-2 mb-3">
                    <GripVertical className="h-4 w-4 text-secondary-300 cursor-grab active:cursor-grabbing" />
                    <span className="text-xs font-mono text-secondary-400 w-4 text-right">{i + 1}</span>
                    <Icon className={`h-4 w-4 ${meta.color}`} />
                    <span className="text-sm font-medium text-secondary-900 flex-1">{meta.label}</span>
                    <button
                      onClick={() => removeStep(i)}
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-secondary-400 hover:text-red-500 transition-all"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Step config */}
                  <div className="ml-12 space-y-2">
                    {step.type === 'run_skill' && (
                      <>
                        <select
                          value={step.config.skillId || ''}
                          onChange={e => updateStepConfig(i, 'skillId', e.target.value)}
                          className="w-full px-3 py-2 bg-secondary-50 border border-secondary-200 rounded-lg text-sm text-secondary-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
                        >
                          <option value="">Select a skill...</option>
                          {skills.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <input
                          value={step.config.prompt || ''}
                          onChange={e => updateStepConfig(i, 'prompt', e.target.value)}
                          placeholder="Instructions (e.g., Check unread emails)"
                          className="w-full px-3 py-2 bg-secondary-50 border border-secondary-200 rounded-lg text-sm text-secondary-900 placeholder:text-secondary-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                      </>
                    )}

                    {step.type === 'ai_task' && (
                      <textarea
                        value={step.config.prompt || ''}
                        onChange={e => updateStepConfig(i, 'prompt', e.target.value)}
                        placeholder="Describe the task for the AI..."
                        rows={2}
                        className="w-full px-3 py-2 bg-secondary-50 border border-secondary-200 rounded-lg text-sm text-secondary-900 placeholder:text-secondary-400 resize-none focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    )}

                    {step.type === 'search_web' && (
                      <input
                        value={step.config.prompt || ''}
                        onChange={e => updateStepConfig(i, 'prompt', e.target.value)}
                        placeholder="Search query..."
                        className="w-full px-3 py-2 bg-secondary-50 border border-secondary-200 rounded-lg text-sm text-secondary-900 placeholder:text-secondary-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    )}

                    {step.type === 'send_message' && (
                      <>
                        <input
                          value={step.config.recipient || ''}
                          onChange={e => updateStepConfig(i, 'recipient', e.target.value)}
                          placeholder="Recipient (e.g., admin@example.com)"
                          className="w-full px-3 py-2 bg-secondary-50 border border-secondary-200 rounded-lg text-sm text-secondary-900 placeholder:text-secondary-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                        <textarea
                          value={step.config.prompt || ''}
                          onChange={e => updateStepConfig(i, 'prompt', e.target.value)}
                          placeholder="Message content..."
                          rows={2}
                          className="w-full px-3 py-2 bg-secondary-50 border border-secondary-200 rounded-lg text-sm text-secondary-900 placeholder:text-secondary-400 resize-none focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                      </>
                    )}

                    {step.type === 'wait_approval' && (
                      <input
                        value={step.config.prompt || ''}
                        onChange={e => updateStepConfig(i, 'prompt', e.target.value)}
                        placeholder="What needs approval?"
                        className="w-full px-3 py-2 bg-secondary-50 border border-secondary-200 rounded-lg text-sm text-secondary-900 placeholder:text-secondary-400 focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    )}

                    {i > 0 && (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={step.useOutputFromPrevious}
                          onChange={e => updateStep(i, { useOutputFromPrevious: e.target.checked })}
                          className="w-4 h-4 text-primary-600 rounded border-secondary-300 focus:ring-primary-500"
                        />
                        <span className="text-xs text-secondary-500">Use output from previous step</span>
                      </label>
                    )}
                  </div>
                </div>

                {/* Flow arrow */}
                <div className="flex justify-center py-1">
                  <ChevronDown className="h-4 w-4 text-secondary-300" />
                </div>
              </React.Fragment>
            );
          })}
        </div>

        {/* Add step */}
        {showStepPicker ? (
          <div className="mt-1">
            <div className="grid grid-cols-2 gap-2 mb-2">
              {STEP_TYPES.map(st => {
                const Icon = st.icon;
                return (
                  <button
                    key={st.type}
                    onClick={() => addStep(st.type)}
                    className="flex items-center gap-3 px-4 py-3 bg-surface-card border border-secondary-200 rounded-lg hover:border-primary-300 hover:bg-primary-50/50 transition-colors text-left"
                  >
                    <Icon className={`h-5 w-5 ${st.color}`} />
                    <span className="text-sm font-medium text-secondary-900">{st.label}</span>
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setShowStepPicker(false)}
              className="w-full text-center text-sm text-secondary-500 hover:text-secondary-700 py-2"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowStepPicker(true)}
            className="w-full border-2 border-dashed border-secondary-200 rounded-lg py-3 text-sm text-secondary-500 hover:border-primary-300 hover:text-primary-600 transition-colors"
          >
            + Add Step
          </button>
        )}
      </div>
    </div>
  );
};
