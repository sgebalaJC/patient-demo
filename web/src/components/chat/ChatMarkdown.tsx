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

/** Parse inline markdown: **bold**, *italic*, `code`, [links](url) */
function parseInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Match: **bold**, *italic*, `code`, [text](url)
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Text before match
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    if (match[2]) {
      // **bold**
      nodes.push(<strong key={match.index} className="font-semibold">{match[2]}</strong>);
    } else if (match[3]) {
      // *italic*
      nodes.push(<em key={match.index}>{match[3]}</em>);
    } else if (match[4]) {
      // `code`
      nodes.push(
        <code key={match.index} className="bg-secondary-200/60 rounded px-1 py-0.5 text-xs font-mono">
          {match[4]}
        </code>
      );
    } else if (match[5] && match[6]) {
      // [text](url)
      nodes.push(
        <a key={match.index} href={match[6]} target="_blank" rel="noopener noreferrer" className="text-primary-400 underline">
          {match[5]}
        </a>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text
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
      blocks.push(<div key={i} className={cls}>{parseInline(headingMatch[2])}</div>);
      i++;
      continue;
    }

    // Bullet list: collect consecutive - or * lines
    if (/^\s*[-*+]\s/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\s*[-*+]\s/.test(lines[i])) {
        const text = lines[i].replace(/^\s*[-*+]\s+/, '');
        items.push(<li key={i}>{parseInline(text)}</li>);
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
        items.push(<li key={i}>{parseInline(text)}</li>);
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
    blocks.push(<p key={i} className="mb-0">{parseInline(line)}</p>);
    i++;
  }

  return blocks;
}
