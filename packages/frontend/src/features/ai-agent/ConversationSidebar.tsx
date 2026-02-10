import { PlusIcon, ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline';
import type { ChatConversation } from '../../hooks/useAi';

interface ConversationSidebarProps {
  conversations: ChatConversation[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
  isLoading: boolean;
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function ConversationSidebar({
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewChat,
  isLoading,
}: ConversationSidebarProps) {
  return (
    <div className="flex flex-col h-full bg-gray-50 border-r border-gray-200">
      {/* New Chat button */}
      <div className="p-3 border-b border-gray-200">
        <button
          onClick={onNewChat}
          className="w-full flex items-center gap-2 rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
        >
          <PlusIcon className="h-4 w-4" />
          New Chat
        </button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-600" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
            <ChatBubbleLeftRightIcon className="h-8 w-8 text-gray-300 mb-2" />
            <p className="text-sm text-gray-400">No conversations yet</p>
            <p className="text-xs text-gray-400 mt-1">Start a new chat to ask questions about your credentialing data</p>
          </div>
        ) : (
          <div className="py-1">
            {conversations.map(conv => (
              <button
                key={conv.id}
                onClick={() => onSelectConversation(conv.id)}
                className={`w-full text-left px-3 py-2.5 border-b border-gray-100 hover:bg-gray-100 transition-colors ${
                  activeConversationId === conv.id ? 'bg-primary-50 border-l-2 border-l-primary-600' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-gray-900 truncate flex-1">
                    {conv.title || 'Untitled'}
                  </p>
                  <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">
                    {relativeTime(conv.updatedAt)}
                  </span>
                </div>
                {conv.lastMessage && (
                  <p className="text-xs text-gray-500 truncate mt-0.5">
                    {conv.lastMessage.role === 'assistant' ? 'AI: ' : ''}
                    {conv.lastMessage.content}
                  </p>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
