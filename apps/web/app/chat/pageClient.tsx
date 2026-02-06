'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Skeleton from '../components/ui/Skeleton';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';
import styles from './page.module.css';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

type ChatResponse = {
  reply: string;
  suggested_actions: string[];
  related_events: Array<{ id: string; title: string }>;
};

type ChatStorage = {
  messages: ChatMessage[];
  suggestions: string[];
  relatedEvents: Array<{ id: string; title: string }>;
};

const STORAGE_KEY = 'timeline-demo.chat';
const MAX_HISTORY = 30;

const createMessage = (role: ChatMessage['role'], content: string): ChatMessage => ({
  id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  role,
  content,
});

export default function ChatPageClient() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [relatedEvents, setRelatedEvents] = useState<Array<{ id: string; title: string }>>([]);
  const [lastPrompt, setLastPrompt] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return;
    }

    try {
      const parsed = JSON.parse(stored) as ChatStorage;
      if (Array.isArray(parsed.messages)) {
        setMessages(parsed.messages.slice(-MAX_HISTORY));
      }
      if (Array.isArray(parsed.suggestions)) {
        setSuggestions(parsed.suggestions);
      }
      if (Array.isArray(parsed.relatedEvents)) {
        setRelatedEvents(parsed.relatedEvents);
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (messages.length === 0 && suggestions.length === 0 && relatedEvents.length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }

    const payload: ChatStorage = {
      messages,
      suggestions,
      relatedEvents,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [messages, suggestions, relatedEvents]);

  const sendMessage = useCallback(
    async (message: string) => {
      if (!message.trim()) {
        return;
      }

      const newMessage = message.trim();
      setMessages((prev) => [...prev, createMessage('user', newMessage)].slice(-MAX_HISTORY));
      setInput('');
      setLoading(true);
      setError(null);
      setSuggestions([]);
      setRelatedEvents([]);
      setLastPrompt(newMessage);

      try {
        const response = await fetchWithTimeout('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: newMessage }),
        });

        if (!response.ok) {
          throw new Error('Unable to reach the chat service.');
        }

        const data = (await response.json()) as ChatResponse;
        setMessages((prev) => [...prev, createMessage('assistant', data.reply)].slice(-MAX_HISTORY));
        setSuggestions(Array.isArray(data.suggested_actions) ? data.suggested_actions : []);
        setRelatedEvents(Array.isArray(data.related_events) ? data.related_events : []);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        setError('We could not deliver that response. Please try again.');
      } finally {
        setLoading(false);
      }
    },
    [setMessages],
  );

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendMessage(input);
  };

  const handleRetry = () => {
    if (lastPrompt) {
      void sendMessage(lastPrompt);
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    setInput(suggestion);
  };

  const handleClearChat = () => {
    setMessages([]);
    setSuggestions([]);
    setRelatedEvents([]);
    setInput('');
    setError(null);
    setLastPrompt(null);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  };

  const hasHistory = messages.length > 0;
  const suggestionList = useMemo(() => suggestions.slice(0, 5), [suggestions]);
  const canClearChat = hasHistory || suggestions.length > 0 || relatedEvents.length > 0;

  return (
    <section className={styles.page}>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Chat</p>
          <h1>Timeline assistant</h1>
          <p>Ask questions and get suggestions powered by the mock chat API.</p>
        </div>
      </div>

      <div className={styles.layout}>
        <Card className={styles.chatPanel}>
          <div className={styles.chatHeader}>
            <h2>Conversation</h2>
            <div className={styles.chatHeaderActions}>
              {loading ? <Badge tone="accent">Assistant typing...</Badge> : null}
              <Button
                type="button"
                variant="secondary"
                onClick={handleClearChat}
                disabled={!canClearChat}
              >
                Clear chat
              </Button>
            </div>
          </div>

          {!hasHistory ? (
            <div className={styles.emptyState}>
              <p>No messages yet. Start by asking about upcoming events or scheduling help.</p>
            </div>
          ) : (
            <div className={styles.chatHistory}>
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={
                    message.role === 'user' ? styles.userMessage : styles.assistantMessage
                  }
                >
                  <p>{message.content}</p>
                </div>
              ))}
            </div>
          )}

          {error ? (
            <div className={styles.errorBox}>
              <p>{error}</p>
              <Button type="button" variant="secondary" onClick={handleRetry}>
                Retry
              </Button>
            </div>
          ) : null}

          <form className={styles.form} onSubmit={handleSubmit}>
            <label className="sr-only" htmlFor="chat-input">
              Ask the assistant
            </label>
            <input
              id="chat-input"
              type="text"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about timelines, events, or schedules"
              aria-label="Chat input"
              className={styles.input}
            />
            <Button type="submit" disabled={loading || !input.trim()}>
              {loading ? 'Sending...' : 'Send'}
            </Button>
          </form>

          {suggestionList.length > 0 ? (
            <div className={styles.suggestionRow}>
              <p className={styles.suggestionLabel}>Try asking:</p>
              <div className={styles.suggestionChips}>
                {suggestionList.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className={styles.chip}
                    onClick={() => handleSuggestionClick(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </Card>

        <Card className={styles.sidePanel}>
          <h2>Related events</h2>
          <p>Suggested follow-ups based on the conversation.</p>
          {loading && relatedEvents.length === 0 ? (
            <div className={styles.relatedSkeletons}>
              {[...Array(3)].map((_, index) => (
                <Skeleton key={`related-skeleton-${index}`} height="12px" width="90%" />
              ))}
            </div>
          ) : relatedEvents.length === 0 ? (
            <p className={styles.emptyMeta}>No related events yet.</p>
          ) : (
            <ul className={styles.relatedList}>
              {relatedEvents.map((event) => (
                <li key={event.id}>{event.title}</li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </section>
  );
}
