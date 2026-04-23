import React, { useState, useEffect } from 'react';
import { Plus, Trash2, FileText, X } from 'lucide-react';
import { sidecar } from '../../lib/sidecar';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { ChatMarkdown } from '../chat/ChatMarkdown';
import { ConfirmModal } from '../ui/ConfirmModal';

interface SkillEntry {
  id: string;
  name: string;
  description: string;
}

export const AgentSkills: React.FC = () => {
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [selected, setSelected] = useState<SkillEntry | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [contentLoading, setContentLoading] = useState(false);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formContent, setFormContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SkillEntry | null>(null);

  useEffect(() => { loadSkills(); }, []);

  const loadSkills = async () => {
    setLoading(true);
    setError('');
    try {
      const { skills } = await sidecar.listSkills();
      setSkills(skills);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load skills');
    } finally {
      setLoading(false);
    }
  };

  const selectSkill = async (skill: SkillEntry) => {
    setSelected(skill);
    setShowForm(false);
    setContentLoading(true);
    try {
      const { content } = await sidecar.readSkill(skill.id);
      setContent(content);
    } catch (err) {
      setContent(`Error loading skill: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setContentLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!formName.trim() || !formContent.trim()) return;
    setSaving(true);
    try {
      const dirName = formName.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
      await sidecar.writeFile(`skills/${dirName}/SKILL.md`, formContent.trim());
      setShowForm(false);
      setFormName('');
      setFormContent('');
      await loadSkills();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create skill');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (skill: SkillEntry) => {
    try {
      await sidecar.deleteFile(`skills/${skill.id}`);
      setDeleteTarget(null);
      if (selected?.id === skill.id) {
        setSelected(null);
        setContent('');
      }
      await loadSkills();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete skill');
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center flex-1"><LoadingSpinner size="md" /></div>;
  }

  return (
    <div className="flex flex-1 min-h-0">
      {/* Skill list */}
      <div className="w-56 shrink-0 border-r border-secondary-200 flex flex-col">
        <div className="p-3 border-b border-secondary-200 flex items-center justify-between">
          <h3 className="text-xs font-semibold text-secondary-500 uppercase tracking-wider">
            Skills ({skills.length})
          </h3>
          <button
            onClick={() => { setShowForm(true); setSelected(null); }}
            className="text-primary-600 hover:text-primary-700 p-1 rounded hover:bg-primary-50"
            title="Install skill"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {skills.length === 0 && !showForm && (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-secondary-400 mb-2">No skills installed</p>
              <button
                onClick={() => setShowForm(true)}
                className="text-xs text-primary-600 hover:underline"
              >
                Install your first skill
              </button>
            </div>
          )}
          {skills.map((skill) => (
            <div
              key={skill.id}
              className={`group flex items-center justify-between px-3 py-2.5 border-b border-secondary-100 cursor-pointer transition-colors ${
                selected?.id === skill.id
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-secondary-700 hover:bg-secondary-50'
              }`}
            >
              <button
                onClick={() => selectSkill(skill)}
                className="flex items-center gap-2 flex-1 text-left min-w-0"
              >
                <FileText className="h-3.5 w-3.5 shrink-0" />
                <span className="text-sm truncate">{skill.name}</span>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setDeleteTarget(skill); }}
                className="opacity-0 group-hover:opacity-100 p-1 text-secondary-400 hover:text-red-500 transition-all"
                title="Uninstall"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto p-6">
        {showForm ? (
          <div className="max-w-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-secondary-900">Install New Skill</h3>
              <button onClick={() => setShowForm(false)} className="text-secondary-400 hover:text-secondary-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <input
              type="text"
              placeholder="Skill name (e.g. patient-summary)"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              className="w-full rounded-lg border border-secondary-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
            <textarea
              placeholder="Paste SKILL.md content here..."
              value={formContent}
              onChange={(e) => setFormContent(e.target.value)}
              rows={16}
              className="w-full rounded-lg border border-secondary-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
            />
            {error && <p className="text-sm text-red-500">{error}</p>}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowForm(false)}
                className="px-4 py-2 text-sm text-secondary-600 hover:text-secondary-800 rounded-lg border border-secondary-300 hover:bg-secondary-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={saving || !formName.trim() || !formContent.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50"
              >
                {saving ? 'Installing...' : 'Install'}
              </button>
            </div>
          </div>
        ) : selected ? (
          contentLoading ? (
            <div className="flex items-center justify-center h-full"><LoadingSpinner size="md" /></div>
          ) : (
            <div className="max-w-2xl">
              <div className="flex items-center gap-2 mb-4">
                <FileText className="h-5 w-5 text-primary-600" />
                <h3 className="text-lg font-semibold text-secondary-900">{selected.name}</h3>
              </div>
              <div className="bg-secondary-50 rounded-lg p-4 border border-secondary-200">
                <ChatMarkdown content={content} variant="assistant" />
              </div>
            </div>
          )
        ) : (
          <div className="flex items-center justify-center h-full text-secondary-400 text-sm">
            {skills.length === 0 ? 'Install a skill to get started' : 'Select a skill to view its details'}
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
        title="Uninstall skill"
        message={
          deleteTarget
            ? `Remove ${deleteTarget.name}? The agent will no longer have access to this skill.`
            : ''
        }
        confirmLabel="Uninstall"
        variant="danger"
      />
    </div>
  );
};
