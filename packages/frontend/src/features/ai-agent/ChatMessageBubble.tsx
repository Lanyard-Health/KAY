import type { ChatMessage } from '../../hooks/useAi';

interface ChatMessageBubbleProps {
  message: ChatMessage;
}

function formatContent(content: string) {
  // Basic markdown: bold, bullet lists, inline code
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];

  lines.forEach((line, i) => {
    let processed: React.ReactNode = line;

    // Bold: **text**
    if (line.includes('**')) {
      const parts = line.split(/\*\*(.*?)\*\*/g);
      processed = parts.map((part, j) =>
        j % 2 === 1 ? <strong key={j}>{part}</strong> : part
      );
    }

    // Inline code: `text`
    if (typeof processed === 'string' && processed.includes('`')) {
      const parts = processed.split(/`(.*?)`/g);
      processed = parts.map((part, j) =>
        j % 2 === 1 ? (
          <code key={j} className="bg-gray-100 px-1 py-0.5 rounded text-sm font-mono">
            {part}
          </code>
        ) : (
          part
        )
      );
    }

    // Bullet points
    const bulletMatch = line.match(/^(\s*[-•*])\s+(.*)/);
    if (bulletMatch) {
      elements.push(
        <li key={i} className="ml-4 list-disc">
          {typeof processed === 'string' ? processed.replace(/^\s*[-•*]\s+/, '') : processed}
        </li>
      );
      return;
    }

    // Numbered list
    const numberMatch = line.match(/^(\s*\d+[.)]\s+)(.*)/);
    if (numberMatch) {
      elements.push(
        <li key={i} className="ml-4 list-decimal">
          {typeof processed === 'string' ? processed.replace(/^\s*\d+[.)]\s+/, '') : processed}
        </li>
      );
      return;
    }

    // Empty line = paragraph break
    if (line.trim() === '') {
      elements.push(<br key={i} />);
      return;
    }

    elements.push(
      <p key={i} className="mb-1">
        {processed}
      </p>
    );
  });

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
