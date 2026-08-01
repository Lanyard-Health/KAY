import type { ChatMessage } from '../../hooks/useAi';

interface ChatMessageBubbleProps {
  message: ChatMessage;
}

// Bold **text** and inline `code`
function formatInline(text: string, key: number): React.ReactNode {
  const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);
  return parts.map((part, j) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${key}-${j}`}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={`${key}-${j}`} className="bg-gray-100 px-1 py-0.5 rounded text-sm font-mono">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

function formatContent(content: string) {
  // Basic markdown: headers, bold, inline code, lists, tables, dividers
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';

    // Table: consecutive |...| lines (separator rows like |---| are skipped)
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i] ?? '')) {
        const cells = (lines[i] ?? '').trim().split('|').slice(1, -1).map(c => c.trim());
        if (!cells.every(c => /^:?-{3,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      i--;
      const [head, ...body] = rows;
      elements.push(
        <table key={i} className="my-2 text-sm border-collapse">
          <thead>
            <tr>
              {(head ?? []).map((c, j) => (
                <th key={j} className="text-left font-semibold border-b border-gray-300 px-2 py-1">{formatInline(c, j)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, j) => (
                  <td key={j} className="border-b border-gray-100 px-2 py-1">{formatInline(c, j)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
      continue;
    }

    // Divider
    if (/^\s*(-{3,}|_{3,}|\*{3,})\s*$/.test(line)) {
      elements.push(<hr key={i} className="my-2 border-gray-200" />);
      continue;
    }

    // Header: #### to #
    const headerMatch = line.match(/^(#{1,4})\s+(.*)/);
    if (headerMatch) {
      const level = headerMatch[1]?.length ?? 2;
      elements.push(
        <p key={i} className={`font-semibold text-gray-900 mt-2 mb-1 ${level <= 2 ? 'text-base' : 'text-sm'}`}>
          {formatInline(headerMatch[2] ?? '', i)}
        </p>
      );
      continue;
    }

    // Bullet points
    const bulletMatch = line.match(/^\s*[-•*]\s+(.*)/);
    if (bulletMatch) {
      elements.push(
        <li key={i} className="ml-4 list-disc">
          {formatInline(bulletMatch[1] ?? '', i)}
        </li>
      );
      continue;
    }

    // Numbered list — keep the model's own numbering (loose <li>s share one counter)
    const numberMatch = line.match(/^\s*(\d+[.)])\s+(.*)/);
    if (numberMatch) {
      elements.push(
        <p key={i} className="ml-4 mb-1">
          {numberMatch[1]}{' '}{formatInline(numberMatch[2] ?? '', i)}
        </p>
      );
      continue;
    }

    // Empty line = paragraph break
    if (line.trim() === '') {
      elements.push(<br key={i} />);
      continue;
    }

    elements.push(
      <p key={i} className="mb-1">
        {formatInline(line, i)}
      </p>
    );
  }

  return elements;
}

export default function ChatMessageBubble({ message }: ChatMessageBubbleProps) {
  const isUser = message.role === 'user';
  const isOptimistic = message.id.startsWith('optimistic-');

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-3 text-sm ${
          isUser
            ? 'bg-green-50 text-gray-900 border border-green-200'
            : 'bg-white text-gray-900 border border-gray-200'
        } ${isOptimistic ? 'opacity-70' : ''}`}
      >
        <div className="whitespace-pre-wrap break-words leading-relaxed">
          {isUser ? message.content : formatContent(message.content)}
        </div>
        <div className={`text-xs mt-2 ${isUser ? 'text-green-500' : 'text-gray-400'}`}>
          {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
}
