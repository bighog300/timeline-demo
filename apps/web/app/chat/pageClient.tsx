'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import RebuildIndexButton from '../calendar/RebuildIndexButton';
import Skeleton from '../components/ui/Skeleton';
import { type ChatContextSelection } from '../lib/chatContextLoader';
import { loadChatContextPrefs, saveChatContextPrefs } from '../lib/chatContextPrefs';
import styles from './page.module.css';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: ChatCitation[];
};

type ChatCitation =
  | {
      artifactId: string;
      title: string;
      dateISO?: string;
      driveWebViewLink?: string;
      kind: 'summary' | 'index' | 'original';
    }
  | {
      artifactId: string;
      title: string;
      kind: 'selection_set';
      selectionSetId: string;
    }
  | {
      artifactId: string;
      title: string;
      kind: 'run';
      runId: string;
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

type ChatErrorCode =
  | 'not_configured'
  | 'invalid_request'
  | 'provider_unauthorized'
  | 'provider_forbidden'
  | 'rate_limited'
  | 'upstream_timeout'
  | 'upstream_error';

type ChatApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
  };
  error_code?: string;
  requestId?: string;
};

type ChatErrorState = {
  message: string;
  requestId: string;
  code: string | null;
};

const STORAGE_KEY = 'timeline-demo.chat';
const ALLOW_ORIGINALS_SESSION_KEY = 'timeline.chat.allowOriginals';
const ADVISOR_MODE_SESSION_KEY = 'timeline.chat.advisorMode';
const SYNTHESIS_MODE_SESSION_KEY = 'timeline.chat.synthesisMode';
const MAX_HISTORY = 30;
const CONFIG_ISSUE_CODES = new Set<ChatErrorCode>([
  'not_configured',
  'invalid_request',
  'provider_unauthorized',
  'provider_forbidden',
]);

const PROVIDER_ERROR_MESSAGES: Record<ChatErrorCode, string> = {
  not_configured: 'Chat provider isn’t configured. Admin: check provider & model in /admin.',
  invalid_request: 'Chat provider rejected the request (check model/parameters).',
  provider_unauthorized: 'Chat provider credentials are invalid or expired.',
  provider_forbidden: 'Chat provider request was forbidden (check account permissions).',
  rate_limited: 'Chat provider rate limit exceeded. Try again later.',
  upstream_timeout: 'Chat provider timed out. Try again later.',
  upstream_error: 'Chat provider error. Please retry.',
};

const isChatErrorCode = (code: string | undefined): code is ChatErrorCode =>
  typeof code === 'string' && code in PROVIDER_ERROR_MESSAGES;

const isConfigIssueCode = (code: string | null): code is ChatErrorCode =>
  typeof code === 'string' && CONFIG_ISSUE_CODES.has(code as ChatErrorCode);

const createMessage = (role: ChatMessage['role'], content: string): ChatMessage => ({
  id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  role,
  content,
});

type ChatContextArtifact = {
  artifactId: string;
  title: string;
  source: 'gmail' | 'drive';
  driveWebViewLink?: string;
};

type ContextCoverageStats = {
  selectionTotal: number;
  summarizedCount: number;
  missingCount: number;
};

type MissingContextItem = {
  source: 'gmail' | 'drive';
  id: string;
  title?: string;
  dateISO?: string;
};

type SelectionSetOption = { driveFileId: string; title: string };

export default function ChatPageClient({
  isAdmin = false,
  contextArtifacts = [],
  indexMissing = false,
  contextKey = 'Recent 8 (All)',
  initialContext = { mode: 'recent', recentCount: 8, sourceFilter: 'all' },
  contextStats,
  missingItems,
}: {
  isAdmin?: boolean;
  contextArtifacts?: ChatContextArtifact[];
  indexMissing?: boolean;
  contextKey?: string;
  initialContext?: ChatContextSelection;
  contextStats?: ContextCoverageStats;
  missingItems?: MissingContextItem[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ChatErrorState | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [lastPrompt, setLastPrompt] = useState<string | null>(null);
  const [allowOriginals, setAllowOriginals] = useState(false);
  const [advisorMode, setAdvisorMode] = useState(true);
  const [synthesisMode, setSynthesisMode] = useState(false);
  const [contextPrefs, setContextPrefs] = useState<ChatContextSelection>(initialContext);
  const [selectionSets, setSelectionSets] = useState<SelectionSetOption[]>([]);
  const [hasHydratedContext, setHasHydratedContext] = useState(false);
  const [summarizeMissingLoading, setSummarizeMissingLoading] = useState(false);
  const [summarizeMissingError, setSummarizeMissingError] = useState<string | null>(null);
  const [summarizeMissingSuccess, setSummarizeMissingSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (contextPrefs.mode !== 'selection_set') {
      return;
    }

    const loadSelectionSets = async () => {
      try {
        const response = await fetch('/api/selection-sets');
        if (!response.ok) {
          return;
        }
        const data = (await response.json()) as {
          sets?: Array<{ driveFileId?: string; title?: string }>;
        };
        const next = (data.sets ?? [])
          .filter((set): set is { driveFileId: string; title: string } =>
            typeof set.driveFileId === 'string' && typeof set.title === 'string',
          )
          .map((set) => ({ driveFileId: set.driveFileId, title: set.title }));
        setSelectionSets(next);
      } catch {
        setSelectionSets([]);
      }
    };

    void loadSelectionSets();
  }, [contextPrefs.mode]);

  useEffect(() => {
    if (!searchParams) {
      return;
    }

    const hasQuery = searchParams.has('mode') || searchParams.has('n') || searchParams.has('source') || searchParams.has('id');
    if (hasQuery || hasHydratedContext) {
      setHasHydratedContext(true);
      return;
    }

    const stored = loadChatContextPrefs();
    setContextPrefs(stored);
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    next.set('mode', stored.mode);
    next.set('source', stored.sourceFilter);
    if (stored.mode === 'recent') {
      next.set('n', String(stored.recentCount));
      next.delete('id');
    } else {
      next.delete('n');
      if (stored.selectionSetId) {
        next.set('id', stored.selectionSetId);
      }
    }
    router.replace(`/chat?${next.toString()}`);
    setHasHydratedContext(true);
  }, [hasHydratedContext, router, searchParams]);

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

    const stored = window.sessionStorage.getItem(ALLOW_ORIGINALS_SESSION_KEY);
    setAllowOriginals(stored === 'true');
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const stored = window.sessionStorage.getItem(ADVISOR_MODE_SESSION_KEY);
    if (stored === null) {
      setAdvisorMode(true);
      window.sessionStorage.setItem(ADVISOR_MODE_SESSION_KEY, 'true');
      return;
    }
    setAdvisorMode(stored === 'true');
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const stored = window.sessionStorage.getItem(SYNTHESIS_MODE_SESSION_KEY);
    setSynthesisMode(stored === 'true');
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
      setErrorStatus(null);
      setSuggestions([]);
      setLastPrompt(newMessage);

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: newMessage,
            allowOriginals,
            advisorMode,
            synthesisMode,
            context: contextPrefs,
          }),
        });

        const data = (await response.json()) as ChatResponse | ChatApiErrorPayload;

        if (!response.ok) {
          const apiError = data as ChatApiErrorPayload;
          const code = apiError.error?.code ?? apiError.error_code ?? null;
          const maybeCode = code ?? undefined;
          const requestId =
            apiError.requestId ?? response.headers.get('x-request-id') ?? 'unknown';

          if (isChatErrorCode(maybeCode)) {
            setError({
              message: PROVIDER_ERROR_MESSAGES[maybeCode],
              requestId,
              code: maybeCode,
            });
          } else {
            setError({
              message: `Chat failed (status ${response.status}).`,
              requestId,
              code,
            });
          }
          setErrorStatus(response.status);
          return;
        }

        const successfulResponse = data as ChatResponse;
        setMessages((prev) =>
          [
            ...prev,
            {
              ...createMessage('assistant', successfulResponse.reply),
              citations: Array.isArray(successfulResponse.citations)
                ? successfulResponse.citations
                : [],
            },
          ].slice(-MAX_HISTORY),
        );
        setSuggestions(
          Array.isArray(successfulResponse.suggested_actions)
            ? successfulResponse.suggested_actions
            : [],
        );
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        setError({
          message: 'We could not deliver that response. Please try again.',
          requestId: 'unknown',
          code: null,
        });
      } finally {
        setLoading(false);
      }
    },
    [advisorMode, allowOriginals, contextPrefs, setMessages, synthesisMode],
  );

  const applyContext = () => {
    saveChatContextPrefs(contextPrefs);
    const next = new URLSearchParams(searchParams?.toString() ?? '');
    next.set('mode', contextPrefs.mode);
    next.set('source', contextPrefs.sourceFilter);
    if (contextPrefs.mode === 'recent') {
      next.set('n', String(contextPrefs.recentCount));
      next.delete('id');
    } else {
      next.delete('n');
      if (contextPrefs.selectionSetId) {
        next.set('id', contextPrefs.selectionSetId);
      }
    }
    router.push(`/chat?${next.toString()}`);
    router.refresh();
  };

  const handleAllowOriginalsChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.checked;
    setAllowOriginals(next);
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(ALLOW_ORIGINALS_SESSION_KEY, next ? 'true' : 'false');
    }
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendMessage(input);
  };

  const handleAdvisorModeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.checked;
    setAdvisorMode(next);
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(ADVISOR_MODE_SESSION_KEY, next ? 'true' : 'false');
    }
  };

  const handleSynthesisModeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const next = event.target.checked;
    setSynthesisMode(next);
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(SYNTHESIS_MODE_SESSION_KEY, next ? 'true' : 'false');
    }
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
    setErrorStatus(null);
    setLastPrompt(null);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  };


  const handleSummarizeMissing = useCallback(async () => {
    if (!contextPrefs.selectionSetId || contextPrefs.mode !== 'selection_set') {
      return;
    }

    setSummarizeMissingLoading(true);
    setSummarizeMissingError(null);
    setSummarizeMissingSuccess(null);

    try {
      const response = await fetch('/api/timeline/summarize-missing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectionSetId: contextPrefs.selectionSetId,
          limit: 5,
          sourceFilter: contextPrefs.sourceFilter,
        }),
      });

      const payload = (await response.json()) as {
        error?: { message?: string };
        summarized?: number;
      };

      if (!response.ok) {
        setSummarizeMissingError(payload.error?.message ?? `Failed to summarize missing items (${response.status}).`);
        return;
      }

      setSummarizeMissingSuccess(`Summarized ${payload.summarized ?? 0} items.`);
      router.refresh();
    } catch {
      setSummarizeMissingError('Failed to summarize missing items.');
    } finally {
      setSummarizeMissingLoading(false);
    }
  }, [contextPrefs.mode, contextPrefs.selectionSetId, contextPrefs.sourceFilter, router]);

  const effectiveMissingCount = contextStats?.missingCount ?? missingItems?.length ?? 0;
  const hasHistory = messages.length > 0;
  const suggestionList = useMemo(() => suggestions.slice(0, 5), [suggestions]);
  const canClearChat = hasHistory || suggestions.length > 0;

  return (
    <section className={styles.page}>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Chat</p>
          <h1>Chat over your saved summaries</h1>
          <p>Ask questions using only your Drive-saved summary artifacts.</p>
        </div>
      </div>

      <div className={styles.layout}>
        

      <Card>
        <h2>Artifacts in context</h2>
        <p className={styles.emptyMeta}>Using: {contextKey}</p>
        {contextPrefs.mode === 'selection_set' && contextStats ? (
          <p className={styles.emptyMeta}>
            Selection: {contextStats.selectionTotal} items · Summarized: {contextStats.summarizedCount} · Missing: {effectiveMissingCount}
          </p>
        ) : null}
        {contextPrefs.mode === 'selection_set' && contextStats && effectiveMissingCount > 0 ? (
          <div className={styles.coverageActions}>
            <Button
              type="button"
              variant="secondary"
              onClick={handleSummarizeMissing}
              disabled={summarizeMissingLoading || !contextPrefs.selectionSetId}
            >
              {summarizeMissingLoading ? 'Summarizing...' : 'Summarize missing (up to 5)'}
            </Button>
            {summarizeMissingSuccess ? <p className={styles.successMeta}>{summarizeMissingSuccess}</p> : null}
            {summarizeMissingError ? <p className={styles.errorInline}>{summarizeMissingError}</p> : null}
          </div>
        ) : null}
        {contextArtifacts.length === 0 ? (
          <p className={styles.emptyMeta}>No saved artifacts found. Create summaries first in Timeline.</p>
        ) : (
          <ul className={styles.relatedList}>
            {contextArtifacts.map((artifact) => (
              <li key={artifact.artifactId}>
                <a
                  href={artifact.driveWebViewLink ?? `/timeline?artifactId=${encodeURIComponent(artifact.artifactId)}`}
                  target={artifact.driveWebViewLink ? '_blank' : undefined}
                  rel={artifact.driveWebViewLink ? 'noreferrer' : undefined}
                >
                  {artifact.title}
                  {' '}· {artifact.source}
                </a>
              </li>
            ))}
          </ul>
        )}
        {indexMissing ? <RebuildIndexButton /> : null}
      </Card>
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
                        {message.citations.map((citation, index) => {
                          const href =
                            citation.kind === 'summary' || citation.kind === 'index' || citation.kind === 'original'
                              ? citation.driveWebViewLink ?? `/timeline?artifactId=${encodeURIComponent(citation.artifactId)}`
                              : '/selection-sets';

                          return (
                            <li key={`${citation.artifactId}-${index}`}>
                              <a href={href} className={styles.citationLink}>
                                {citation.title}
                                {'dateISO' in citation && citation.dateISO ? ` (${citation.dateISO})` : ''}
                              </a>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          {error ? (
            <div className={styles.errorBox}>
              <p>{error.message}</p>
              <p>Request ID: {error.requestId}</p>
              {isConfigIssueCode(error.code) ? (
                <p>{isAdmin ? 'Check /admin provider settings.' : 'Contact your administrator.'}</p>
              ) : null}
              <div className={styles.errorActions}>
                <Button type="button" variant="secondary" onClick={handleRetry}>
                  Retry
                </Button>
                {errorStatus === 401 ? (
                  <Link className={styles.reconnectLink} href="/connect">
                    Reconnect Google
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}

          <form className={styles.form} onSubmit={handleSubmit}>
            <div className={styles.toggleGroup}>
              <div className={styles.toggleRow}>
                <label>
                  Mode
                  <select
                    value={contextPrefs.mode}
                    onChange={(event) =>
                      setContextPrefs((prev) => ({ ...prev, mode: event.target.value as ChatContextSelection['mode'] }))
                    }
                  >
                    <option value="recent">Recent</option>
                    <option value="selection_set">Selection Set</option>
                  </select>
                </label>
                {contextPrefs.mode === 'recent' ? (
                  <label>
                    Count
                    <select
                      value={contextPrefs.recentCount}
                      onChange={(event) =>
                        setContextPrefs((prev) => ({
                          ...prev,
                          recentCount: Number(event.target.value) as ChatContextSelection['recentCount'],
                        }))
                      }
                    >
                      <option value={8}>8</option>
                      <option value={20}>20</option>
                      <option value={50}>50</option>
                    </select>
                  </label>
                ) : (
                  <label>
                    Selection set
                    <select
                      value={contextPrefs.selectionSetId ?? ''}
                      onChange={(event) =>
                        setContextPrefs((prev) => ({ ...prev, selectionSetId: event.target.value || undefined }))
                      }
                    >
                      <option value="">Choose a selection set</option>
                      {selectionSets.map((set) => (
                        <option key={set.driveFileId} value={set.driveFileId}>
                          {set.title}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  Source
                  <select
                    value={contextPrefs.sourceFilter}
                    onChange={(event) =>
                      setContextPrefs((prev) => ({
                        ...prev,
                        sourceFilter: event.target.value as ChatContextSelection['sourceFilter'],
                      }))
                    }
                  >
                    <option value="all">All</option>
                    <option value="gmail">Gmail</option>
                    <option value="drive">Drive</option>
                  </select>
                </label>
                <Button type="button" variant="secondary" onClick={applyContext}>
                  Apply
                </Button>
              </div>
            </div>
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

          <div className={styles.toggleGroup}>
            <div className={styles.toggleRow}>
              <label className={styles.toggleLabel}>
                <input
                  type="checkbox"
                  checked={allowOriginals}
                  onChange={handleAllowOriginalsChange}
                />
                <span>Allow opening originals (this session)</span>
              </label>
              <p className={styles.toggleHelp}>
                When enabled, Chat may fetch the original email/file for relevant sources to answer
                more accurately. Originals are not stored.
              </p>
            </div>

            <div className={styles.toggleRow}>
              <label className={styles.toggleLabel}>
                <input
                  type="checkbox"
                  checked={advisorMode}
                  onChange={handleAdvisorModeChange}
                />
                <span>Advisor mode (timeline insight)</span>
              </label>
              <p className={styles.toggleHelp}>
                Structures answers as a timeline review with legal and psychological issue-spotting.
              </p>
            </div>

            <div className={styles.toggleRow}>
              <label className={styles.toggleLabel}>
                <input
                  type="checkbox"
                  checked={synthesisMode}
                  onChange={handleSynthesisModeChange}
                />
                <span>Synthesis mode (timeline overview)</span>
              </label>
              <p className={styles.toggleHelp}>
                Builds a cross-document timeline of events, actors, and themes.
              </p>
            </div>
          </div>

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
