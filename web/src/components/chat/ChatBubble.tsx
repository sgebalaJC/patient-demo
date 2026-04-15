import { useState } from 'react';
import { Copy, Check, Trash2, FileText, Image } from 'lucide-react';
import { ChatMarkdown } from './ChatMarkdown';

interface ChatAttachment {
  name: string;
  mimeType: string;
  size?: number;
  /** Cloud Storage download URL — when present, image attachments render inline. */
  url?: string;
  storagePath?: string;
}

interface ChatBubbleProps {
  role: 'user' | 'assistant';
  content: string;
  attachments?: ChatAttachment[];
  onDelete?: () => void;
}

export function ChatBubble({ role, content, attachments, onDelete }: ChatBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [showActions, setShowActions] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const isImg = (mime: string) => mime.startsWith('image/');

  return (
    <div
      className={`group flex ${role === 'user' ? 'justify-end' : 'justify-start'}`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div className="relative max-w-[80%]">
        <div
          className={`rounded-xl px-4 py-2.5 text-sm ${
            role === 'user'
              ? 'bg-primary-600 text-white rounded-br-sm'
              : 'text-secondary-900 rounded-bl-sm border border-secondary-200'
          }`}
          style={role === 'assistant' ? { background: 'var(--chat-bubble-assistant)' } : undefined}
        >
          <ChatMarkdown content={content} variant={role} />
          {attachments && attachments.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {attachments.map((att, i) =>
                isImg(att.mimeType) && att.url ? (
                  <a
                    key={i}
                    href={att.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block"
                  >
                    <img
                      src={att.url}
                      alt={att.name}
                      loading="lazy"
                      className="max-h-48 rounded-md border border-secondary-200 bg-white"
                    />
                  </a>
                ) : (
                  <div
                    key={i}
                    className={`flex items-center gap-1.5 text-xs ${
                      role === 'user' ? 'text-white/80' : 'text-secondary-500'
                    }`}
                  >
                    {isImg(att.mimeType) ? <Image className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                    <span className="truncate">{att.name}</span>
                  </div>
                ),
              )}
            </div>
          )}
        </div>

        {/* Actions — show on hover */}
        {showActions && content && (
          <div className={`absolute top-0 flex items-center gap-0.5 ${
            role === 'user' ? '-left-16' : '-right-16'
          }`}>
            <button
              onClick={handleCopy}
              className="p-1 rounded hover:bg-secondary-100 text-secondary-400 hover:text-secondary-600 transition-colors"
              title="Copy message"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            {onDelete && (
              <button
                onClick={onDelete}
                className="p-1 rounded hover:bg-red-50 text-secondary-400 hover:text-red-500 transition-colors"
                title="Delete message"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
