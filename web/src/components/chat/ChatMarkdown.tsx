import React from 'react';

interface ChatMarkdownProps {
  content: string;
  variant: 'user' | 'assistant';
}

/**
 * Lightweight markdown renderer — no external dependencies.
 * Handles: bold, italic, inline code, links, bullet/numbered lists, headings.
 * User messages render as plain text; assistant messages get formatting.
 */
export const ChatMarkdown: React.FC<ChatMarkdownProps> = ({ content, variant }) => {
  if (variant === 'user' || !content) {
    return <span className="whitespace-pre-wrap">{content}</span>;
  }

  return <div className="space-y-1.5">{parseBlocks(content)}</div>;
};

/**
 * URL allowlist for inline images returned by the agent. Only renders
 * https URLs and Firebase Storage download URLs; everything else falls
 * back to a regular link to keep arbitrary data URIs / file:// out.
 */
function isSafeImageUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('https://')) return true;
  if (url.startsWith('http://') && url.includes('localhost')) return true;
  return false;
}

/** Parse inline markdown: ![alt](url) images, **bold**, *italic*, `code`, [links](url) */
function parseInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Image syntax must come before plain link syntax so `![alt](url)` doesn't
  // get matched as a link followed by a stray `!`.
  const regex =
    /(!\[([^\]]*)\]\(([^)]+)\)|\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    if (match[3] !== undefined) {
      // ![alt](url) — agent-returned inline image
      const alt = match[2];
      const url = match[3];
      if (isSafeImageUrl(url)) {
        nodes.push(
          <a key={`inline-${match.index}`} href={url} target="_blank" rel="noopener noreferrer" className="block my-1">
            <img
              src={url}
              alt={alt}
              loading="lazy"
              className="max-h-64 rounded-md border border-secondary-200 bg-white"
            />
          </a>,
        );
      } else {
        // Unsafe URL → fall back to a labelled link.
        nodes.push(
          <a key={`inline-${match.index}`} href={url} target="_blank" rel="noopener noreferrer" className="text-primary-400 underline">
            {alt || 'image'}
          </a>,
        );
      }
    } else if (match[4]) {
      nodes.push(<strong key={`inline-${match.index}`} className="font-semibold">{match[4]}</strong>);
    } else if (match[5]) {
      nodes.push(<em key={`inline-${match.index}`}>{match[5]}</em>);
    } else if (match[6]) {
      nodes.push(
        <code key={`inline-${match.index}`} className="bg-secondary-200/60 rounded px-1 py-0.5 text-xs font-mono">
          {match[6]}
        </code>,
      );
    } else if (match[7] && match[8]) {
      nodes.push(
        <a key={`inline-${match.index}`} href={match[8]} target="_blank" rel="noopener noreferrer" className="text-primary-400 underline">
          {match[7]}
        </a>,
      );
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [text];
}

/** Parse block-level markdown: headings, lists, paragraphs */
function parseBlocks(content: string): React.ReactNode[] {
  const lines = content.split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Heading: ### text
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const cls = level === 1 ? 'text-base font-semibold' : level === 2 ? 'text-sm font-semibold' : 'text-sm font-medium';
      blocks.push(<div key={`h-${i}`} className={cls}>{parseInline(headingMatch[2])}</div>);
      i++;
      continue;
    }

    // Bullet list: collect consecutive - or * lines
    if (/^\s*[-*+]\s/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\s*[-*+]\s/.test(lines[i])) {
        const text = lines[i].replace(/^\s*[-*+]\s+/, '');
        items.push(<li key={`uli-${i}`}>{parseInline(text)}</li>);
        i++;
      }
      blocks.push(<ul key={`ul-${i}`} className="list-disc pl-4 space-y-0.5">{items}</ul>);
      continue;
    }

    // Numbered list: collect consecutive 1. 2. lines
    if (/^\s*\d+[.)]\s/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s/.test(lines[i])) {
        const text = lines[i].replace(/^\s*\d+[.)]\s+/, '');
        items.push(<li key={`oli-${i}`}>{parseInline(text)}</li>);
        i++;
      }
      blocks.push(<ol key={`ol-${i}`} className="list-decimal pl-4 space-y-0.5">{items}</ol>);
      continue;
    }

    // Empty line — skip
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Regular paragraph
    blocks.push(<p key={`p-${i}`} className="mb-0">{parseInline(line)}</p>);
    i++;
  }

  return blocks;
}
