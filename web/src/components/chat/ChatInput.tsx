import React, { useEffect, useRef, useState } from 'react';
import { Send, Paperclip, X, FileText } from 'lucide-react';
import { getInputHistory } from './input-history';

const ALLOWED_TYPES = [
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'application/pdf', 'text/plain', 'text/csv',
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  sending: boolean;
  placeholder?: string;
  pendingFiles: File[];
  onFilesChange: (files: File[]) => void;
  /** Persistent input-history key (localStorage). Defaults to 'default'. */
  historyKey?: string;
}

const isImage = (mimeType: string) => mimeType.startsWith('image/');

/**
 * Shared chat input with attachment support (admin agent + patient support).
 */
export const ChatInput: React.FC<ChatInputProps> = ({
  value,
  onChange,
  onSend,
  sending,
  placeholder = 'Type a message...',
  pendingFiles,
  onFilesChange,
  historyKey = 'default',
}) => {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const history = getInputHistory(historyKey);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const valid = files.filter(f => ALLOWED_TYPES.includes(f.type) && f.size <= MAX_FILE_SIZE);
    onFilesChange([...pendingFiles, ...valid]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (index: number) => {
    onFilesChange(pendingFiles.filter((_, i) => i !== index));
  };

  const handleSend = () => {
    // eslint-disable-next-line no-console
    console.log('[ChatInput] handleSend ENTER', { historyKey, value: JSON.stringify(value), trimmed: value.trim() });
    if (value.trim()) {
      history.push(value);
      // eslint-disable-next-line no-console
      console.log('[ChatInput] push', JSON.stringify(value), 'historyKey=', historyKey, 'items now=', (history as unknown as { items: string[] }).items);
    }
    onSend();
    // Refocus after send so user can keep typing
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      // eslint-disable-next-line no-console
      console.log('[ChatInput]', e.key, {
        historyKey,
        value: JSON.stringify(value),
        valueEmpty: !value.trim(),
        items: (history as unknown as { items: string[] }).items,
        cursor: (history as unknown as { cursor: number }).cursor,
      });
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      // eslint-disable-next-line no-console
      console.log('[ChatInput] Enter pressed', { sending, value: JSON.stringify(value) });
      e.preventDefault();
      if (!sending) handleSend();
      return;
    }
    if (!value.trim()) {
      if (e.key === 'ArrowUp') {
        const prev = history.up();
        // eslint-disable-next-line no-console
        console.log('[ChatInput] ArrowUp -> prev=', JSON.stringify(prev));
        if (prev !== null) {
          e.preventDefault();
          onChange(prev);
        }
        return;
      }
      if (e.key === 'ArrowDown') {
        const next = history.down();
        // eslint-disable-next-line no-console
        console.log('[ChatInput] ArrowDown -> next=', JSON.stringify(next));
        e.preventDefault();
        onChange(next ?? '');
      }
    }
  };

  return (
    <div className="p-3">
      {/* Pending files preview — image thumbnails for image/*, chip for others */}
      {pendingFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {pendingFiles.map((file, i) =>
            isImage(file.type) ? (
              <PendingImageThumb key={i} file={file} onRemove={() => removeFile(i)} />
            ) : (
              <div
                key={i}
                className="flex items-center gap-1.5 bg-secondary-100 rounded-lg px-2 py-1 text-xs text-secondary-700"
              >
                <FileText className="h-3 w-3 text-secondary-500" />
                <span className="truncate max-w-[120px]">{file.name}</span>
                <button onClick={() => removeFile(i)} className="text-secondary-400 hover:text-secondary-600">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ),
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        {/* Attach button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={sending}
          className="flex-shrink-0 p-2 rounded-lg text-secondary-400 hover:text-secondary-600 hover:bg-secondary-100 transition-colors disabled:opacity-50"
          title="Attach file"
        >
          <Paperclip className="h-4 w-4" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_TYPES.join(',')}
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />

        <textarea
          ref={inputRef}
          value={value}
          onChange={(e) => {
            // eslint-disable-next-line no-console
            console.log('[ChatInput] textarea onChange', JSON.stringify(e.target.value));
            history.reset();
            onChange(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          className="flex-1 resize-none rounded-lg border border-secondary-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        />

        <button
          onClick={handleSend}
          disabled={(!value.trim() && pendingFiles.length === 0) || sending}
          className="chat-send-btn flex-shrink-0 p-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

/** Image preview chip — uses an object URL to render the local file as a
 *  thumbnail before the upload completes. Revokes the URL on unmount. */
const PendingImageThumb: React.FC<{ file: File; onRemove: () => void }> = ({ file, onRemove }) => {
  const [url, setUrl] = useState<string>('');
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return (
    <div className="relative group">
      {url && (
        <img
          src={url}
          alt={file.name}
          className="h-16 w-16 object-cover rounded-md border border-secondary-200"
        />
      )}
      <button
        onClick={onRemove}
        className="absolute -top-1.5 -right-1.5 bg-secondary-700 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
        title={`Remove ${file.name}`}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
};

