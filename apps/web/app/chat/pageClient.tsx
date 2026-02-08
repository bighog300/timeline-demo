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
  citations?: ChatCitation[];
};

type ChatCitation = {
  artifactId: string;
  title: string;
  dateISO?: string;
  kind: 'summary' | 'index' | 'selection_set';
};

type ChatResponse = {
  reply: string;
  citations?: ChatCitation[];
  suggested_actions: string[];
  provider?: { name: string; model: string };
  requestId?: string;
};

type ChatStorage = {
  messages: ChatMessage[];
  suggestions: string[];
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
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (messages.length === 0 && suggestions.length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }

    const payload: ChatStorage = {
      messages,
      suggestions,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [messages, suggestions]);

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
      setLastPrompt(newMessage);

      try {
        const response = await fetchWithTimeout('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: newMessage }),
        });

        const data = (await response.json()) as ChatResponse;
        setMessages((prev) =>
          [
            ...prev,
            {
              ...createMessage('assistant', data.reply),
              citations: Array.isArray(data.citations) ? data.citations : [],
            },
          ].slice(-MAX_HISTORY),
        );
        setSuggestions(Array.isArray(data.suggested_actions) ? data.suggested_actions : []);
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
    setInput('');
    setError(null);
    setLastPrompt(null);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  };

  const hasHistory = messages.length > 0;
  const suggestionList = useMemo(() => suggestions.slice(0, 5), [suggestions]);
  const canClearChat = hasHistory || suggestions.length > 0;

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
              <p>No messages yet. Start by asking about your schedule or a timeline summary.</p>
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
                  {message.role === 'assistant' &&
                  Array.isArray(message.citations) &&
                  message.citations.length > 0 ? (
                    <div className={styles.citations}>
                      <p className={styles.citationsLabel}>Sources</p>
                      <ul className={styles.citationsList}>
                        {message.citations.map((citation, index) => (
                          <li key={`${citation.artifactId}-${index}`}>
                            <a
                              href={`/timeline?artifactId=${encodeURIComponent(
                                citation.artifactId,
                              )}`}
                              className={styles.citationLink}
                            >
                              {citation.title}
                              {citation.dateISO ? ` (${citation.dateISO})` : ''}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
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
              placeholder="Ask about timelines, summaries, or schedules"
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
          <h2>Suggested prompts</h2>
          <p>Use these ideas to keep the conversation moving.</p>
          {loading && suggestionList.length === 0 ? (
            <div className={styles.relatedSkeletons}>
              {[...Array(3)].map((_, index) => (
                <Skeleton key={`suggestion-skeleton-${index}`} height="12px" width="90%" />
              ))}
            </div>
          ) : suggestionList.length === 0 ? (
            <p className={styles.emptyMeta}>No suggestions yet.</p>
          ) : (
            <ul className={styles.relatedList}>
              {suggestionList.map((suggestion) => (
                <li key={suggestion}>{suggestion}</li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </section>
  );
}
