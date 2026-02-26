import { useState, useRef, useEffect, useCallback } from 'react';
import { PaperAirplaneIcon, ChatBubbleLeftRightIcon, Bars3Icon, XMarkIcon } from '@heroicons/react/24/outline';
import {
  useChatConversations,
  useChatMessages,
  useSendChatMessage,
} from '../../hooks/useAi';
import type { ChatMessage } from '../../hooks/useAi';
import ChatMessageBubble from './ChatMessageBubble';
import ConversationSidebar from './ConversationSidebar';

function TypingIndicator() {
  return (
    <div className="flex justify-start mb-3">
      <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  );
}

export default function ChatPanel() {
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: convsResp, isLoading: convsLoading } = useChatConversations();
  const { data: msgsResp } = useChatMessages(activeConversationId);
  const sendMessage = useSendChatMessage();

  const conversations = convsResp?.data || [];
  const messages: ChatMessage[] = msgsResp?.data?.messages || [];

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, sendMessage.isPending]);

  // Auto-resize textarea
  const adjustTextarea = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const maxHeight = 4 * 24; // ~4 lines
    ta.style.height = `${Math.min(ta.scrollHeight, maxHeight)}px`;
  }, []);

  useEffect(() => {
    adjustTextarea();
  }, [inputValue, adjustTextarea]);

  const handleSend = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed || sendMessage.isPending) return;

    setInlineError(null);
    setInputValue('');

    try {
      const result = await sendMessage.mutateAsync({
        conversationId: activeConversationId || undefined,
        message: trimmed,
      });

      // If this was a new conversation, set it as active
      if (!activeConversationId && result.data.conversationId) {
        setActiveConversationId(result.data.conversationId);
      }
    } catch (error: any) {
      const errorMsg = error.response?.data?.error || error.message || 'Failed to send message';
      setInlineError(errorMsg);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNewChat = () => {
    setActiveConversationId(null);
    setInputValue('');
    setInlineError(null);
  };

  return (
    <div className="flex h-[calc(100vh-16rem)] rounded-2xl bg-white shadow-sm border border-gray-200/60 overflow-hidden">
      {/* Sidebar */}
      <div
        className={`${
          sidebarOpen ? 'w-72' : 'w-0'
        } transition-all duration-200 overflow-hidden flex-shrink-0`}
      >
        <ConversationSidebar
          conversations={conversations}
          activeConversationId={activeConversationId}
          onSelectConversation={setActiveConversationId}
          onNewChat={handleNewChat}
          isLoading={convsLoading}
        />
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Chat header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-gray-400 hover:text-gray-600"
          >
            {sidebarOpen ? <XMarkIcon className="h-5 w-5" /> : <Bars3Icon className="h-5 w-5" />}
          </button>
          <h3 className="text-sm font-medium text-gray-900 truncate">
            {activeConversationId
              ? msgsResp?.data?.conversation?.title || 'Chat'
              : 'New Conversation'}
          </h3>
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto px-4 py-4 bg-gray-50">
          {messages.length === 0 && !activeConversationId ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <ChatBubbleLeftRightIcon className="h-12 w-12 text-gray-300 mb-3" />
              <h3 className="text-lg font-medium text-gray-700 mb-1">Ask me anything</h3>
              <p className="text-sm text-gray-400 max-w-md">
                Ask about enrollment statuses, expiring credentials, provider information, or what to prioritize today.
              </p>
              <div className="flex flex-wrap gap-2 mt-4 max-w-lg justify-center">
                {[
                  'Which enrollments are overdue?',
                  'What should I prioritize today?',
                  'Any credentials expiring soon?',
                  'Show me all pending enrollments',
                ].map(suggestion => (
                  <button
                    key={suggestion}
                    onClick={() => setInputValue(suggestion)}
                    className="text-xs bg-white border border-gray-200 rounded-full px-3 py-1.5 text-gray-600 hover:bg-gray-100 hover:border-gray-300 transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map(msg => (
                <ChatMessageBubble key={msg.id} message={msg} />
              ))}
              {sendMessage.isPending && <TypingIndicator />}
              {inlineError && (
                <div className="flex justify-center mb-3">
                  <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700 max-w-[80%]">
                    {inlineError}
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Input area */}
        <div className="border-t border-gray-200 bg-white px-4 py-3">
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about enrollments, credentials, providers..."
              rows={1}
              className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              disabled={sendMessage.isPending}
            />
            <button
              onClick={handleSend}
              disabled={!inputValue.trim() || sendMessage.isPending}
              className="flex-shrink-0 rounded-lg bg-primary-600 p-2 text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <PaperAirplaneIcon className="h-5 w-5" />
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            Press Enter to send, Shift+Enter for new line
          </p>
        </div>
      </div>
    </div>
  );
}
