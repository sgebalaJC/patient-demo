import React, { useRef } from 'react';
import { Send, Paperclip, X, FileText, Image } from 'lucide-react';

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
}) => {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    onSend();
    // Refocus after send so user can keep typing
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sending) handleSend();
    }
  };

  return (
    <div className="border-t border-secondary-200 p-3">
      {/* Pending files preview */}
      {pendingFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {pendingFiles.map((file, i) => (
            <div key={i} className="flex items-center gap-1.5 bg-secondary-100 rounded-lg px-2 py-1 text-xs text-secondary-700">
              {isImage(file.type)
                ? <Image className="h-3 w-3 text-secondary-500" />
                : <FileText className="h-3 w-3 text-secondary-500" />
              }
              <span className="truncate max-w-[120px]">{file.name}</span>
              <button onClick={() => removeFile(i)} className="text-secondary-400 hover:text-secondary-600">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
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
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          className="flex-1 resize-none rounded-lg border border-secondary-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
        />

        <button
          onClick={handleSend}
          disabled={(!value.trim() && pendingFiles.length === 0) || sending}
          className="flex-shrink-0 p-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

/** Convert a File to base64 (strips the data:xxx;base64, prefix). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] || result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
