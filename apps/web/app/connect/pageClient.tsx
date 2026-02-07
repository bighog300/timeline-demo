'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { signIn, signOut, useSession } from 'next-auth/react';

import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import styles from './connect.module.css';

type ProvisionState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; folderId: string; folderName: string }
  | { status: 'error'; message: string };

type ConnectPageClientProps = {
  isConfigured: boolean;
  scopeStatus: {
    configured: string[];
    missing: string[];
    isComplete: boolean;
  };
};

const formatDateTime = (value?: string) => {
  if (!value) {
    return '—';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
};

const STORAGE_KEYS_TO_CLEAR = [
  'timeline.gmailSelections',
  'timeline.driveSelections',
  'timeline.summaryArtifacts',
  'timeline.lastSyncISO',
];

const clearTimelineStorage = () => {
  if (typeof window === 'undefined') {
    return;
  }
  STORAGE_KEYS_TO_CLEAR.forEach((key) => window.localStorage.removeItem(key));
};

const SCOPE_EXPLANATIONS: Record<string, string> = {
  'https://www.googleapis.com/auth/gmail.readonly':
    'Read message metadata + content for messages you explicitly select.',
  'https://www.googleapis.com/auth/drive.readonly':
    'List and read files you explicitly select from Drive.',
  'https://www.googleapis.com/auth/drive.file':
    'Create/update Timeline summaries and selection sets in the app folder.',
};

export default function ConnectPageClient({ isConfigured, scopeStatus }: ConnectPageClientProps) {
  const { data: session, status, update } = useSession();
  const [provisionState, setProvisionState] = useState<ProvisionState>({ status: 'idle' });
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupError, setCleanupError] = useState<string | null>(null);
  const [cleanupPreview, setCleanupPreview] = useState<{ id: string; name: string }[]>([]);
  const [cleanupConfirmText, setCleanupConfirmText] = useState('');

  const scopes = useMemo(() => session?.scopes ?? [], [session?.scopes]);
  const configuredScopes = scopeStatus.configured;
  const missingScopes = scopeStatus.missing;
  const scopesReady = scopeStatus.isComplete;
  const isSignedIn = status === 'authenticated';
  const driveFolderId = provisionState.status === 'success' ? provisionState.folderId : session?.driveFolderId;

  const handleProvision = async () => {
    setProvisionState({ status: 'loading' });

    const response = await fetch('/api/google/drive/provision', { method: 'POST' });

    if (response.status === 401) {
      setProvisionState({
        status: 'error',
        message: 'Reconnect required. Please sign in again to provision the folder.',
      });
      return;
    }

    if (!response.ok) {
      setProvisionState({ status: 'error', message: 'Unable to provision the Drive folder.' });
      return;
    }

    const payload = (await response.json()) as { folderId: string; folderName: string };
    setProvisionState({
      status: 'success',
      folderId: payload.folderId,
      folderName: payload.folderName,
    });
    await update?.();
  };

  const handleDisconnect = async () => {
    clearTimelineStorage();
    await fetch('/api/google/disconnect', { method: 'POST' });
    await signOut({ callbackUrl: '/connect' });
  };

  const handleCleanupPreview = async () => {
    setCleanupLoading(true);
    setCleanupError(null);
    const response = await fetch('/api/google/drive/cleanup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dryRun: true }),
    });

    if (response.status === 401) {
      setCleanupError('Reconnect required to list app data.');
      setCleanupLoading(false);
      return;
    }

    if (!response.ok) {
      setCleanupError('Unable to list app data in Drive.');
      setCleanupLoading(false);
      return;
    }

    const payload = (await response.json()) as { files: { id: string; name: string }[] };
    setCleanupPreview(payload.files ?? []);
    setCleanupLoading(false);
  };

  const handleCleanupConfirm = async () => {
    if (cleanupConfirmText !== 'DELETE') {
      setCleanupError('Type DELETE to confirm removal.');
      return;
    }

    setCleanupLoading(true);
    setCleanupError(null);
    const response = await fetch('/api/google/drive/cleanup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    });

    if (response.status === 401) {
      setCleanupError('Reconnect required to delete app data.');
      setCleanupLoading(false);
      return;
    }

    if (!response.ok) {
      setCleanupError('Unable to delete app data in Drive.');
      setCleanupLoading(false);
      return;
    }

    setCleanupPreview([]);
    setCleanupConfirmText('');
    setCleanupLoading(false);
  };

  const connectionLabel = isSignedIn ? 'Signed in' : 'Signed out';
  const lastRefresh = session?.lastTokenRefresh;
  const canProvision = isConfigured && scopesReady && isSignedIn && provisionState.status !== 'loading';
  const showScopeConfigError = isConfigured && !scopesReady;
  const driveFolderLink = driveFolderId
    ? `https://drive.google.com/drive/folders/${driveFolderId}`
    : null;

  return (
    <section className={styles.page}>
      <div className={styles.header}>
        <div>
          <p>Connect your Google account to start building a real Timeline.</p>
          <h1>Google Connection</h1>
        </div>
        <div className={styles.actions}>
          <Button
            onClick={() => signIn('google')}
            variant="primary"
            disabled={!isConfigured || !scopesReady || isSignedIn}
          >
            Connect Google
          </Button>
          <Button
            onClick={handleDisconnect}
            variant="secondary"
            disabled={!isSignedIn}
          >
            Disconnect Google
          </Button>
        </div>
      </div>

      {!isConfigured ? (
        <Card>
          <h2>Google OAuth not configured</h2>
          <p>
            Add the Google OAuth environment variables to enable sign-in. See the README for
            required keys and redirect URLs.
          </p>
        </Card>
      ) : null}

      {showScopeConfigError ? (
        <Card>
          <h2>Config incomplete</h2>
          <p>
            GOOGLE_SCOPES is missing required permissions. Update the environment configuration and
            redeploy before connecting.
          </p>
          <ul className={styles.scopeDetails}>
            {missingScopes.map((scope) => (
              <li key={scope}>
                <Badge tone="warning">{scope}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className={styles.grid}>
        <Card>
          <h2>Connection status</h2>
          <ul className={styles.statusList}>
            <li>
              <span>Session</span>
              <Badge tone={status === 'authenticated' ? 'success' : 'warning'}>{connectionLabel}</Badge>
            </li>
            <li>
              <span>Scopes</span>
              <div className={styles.scopeList}>
                {scopes.length > 0 ? (
                  scopes.map((scope) => (
                    <Badge key={scope} tone="accent">
                      {scope}
                    </Badge>
                  ))
                ) : (
                  <span className={styles.muted}>Not connected</span>
                )}
              </div>
            </li>
            <li>
              <span>Last token refresh</span>
              <span className={styles.muted}>{formatDateTime(lastRefresh)}</span>
            </li>
          </ul>
        </Card>

        <Card>
          <h2>Drive folder provisioning</h2>
          <p>
            Provision a Drive folder where Timeline can store derived artifacts (summaries,
            indexes) owned by you.
          </p>
          <div className={styles.provisionActions}>
            <Button
              onClick={handleProvision}
              variant="primary"
              disabled={!canProvision}
            >
              {provisionState.status === 'loading' ? 'Provisioning...' : 'Provision Drive folder'}
            </Button>
            {provisionState.status === 'success' ? (
              <Badge tone="success">Folder ready</Badge>
            ) : null}
          </div>
          {provisionState.status === 'success' ? (
            <div className={styles.provisionDetails}>
              <p>
                Provisioned: <strong>{provisionState.folderName}</strong>
              </p>
              <p className={styles.muted}>Folder ID: {provisionState.folderId}</p>
            </div>
          ) : null}
          {provisionState.status === 'idle' && session?.driveFolderId ? (
            <div className={styles.provisionDetails}>
              <p>
                Provisioned folder ID: <strong>{session.driveFolderId}</strong>
              </p>
            </div>
          ) : null}
          {provisionState.status === 'error' ? (
            <p className={styles.error}>{provisionState.message}</p>
          ) : null}
          {status !== 'authenticated' ? (
            <p className={styles.muted}>
              Sign in to provision. If you&apos;re seeing reconnect errors, visit{' '}
              <Link href="/connect">/connect</Link>.
            </p>
          ) : null}
          {status === 'authenticated' && !scopesReady ? (
            <p className={styles.error}>Scopes missing. Update GOOGLE_SCOPES and reconnect.</p>
          ) : null}
        </Card>

        <Card>
          <h2>Scopes &amp; data access</h2>
          <p className={styles.muted}>
            Timeline only touches items you explicitly select. No background scanning, ever.
          </p>
          <ul className={styles.scopeDetails}>
            <li>
              <strong>Read access:</strong> only selected Gmail messages and Drive files.
            </li>
            <li>
              <strong>Write access:</strong> summaries, selection sets, and the index file inside the
              app folder.
            </li>
            <li>
              <strong>No background scanning:</strong> we only fetch what you click.
            </li>
          </ul>
          <div className={styles.scopeBlock}>
            <p className={styles.muted}>Requested scopes</p>
            <ul className={styles.scopeDetails}>
              {configuredScopes.map((scope) => (
                <li key={scope}>
                  <Badge tone="accent">{scope}</Badge>
                  <span className={styles.scopeReason}>
                    {SCOPE_EXPLANATIONS[scope] ?? 'Custom scope configured for this environment.'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Card>

        <Card>
          <h2>Data model &amp; storage</h2>
          <ul className={styles.scopeDetails}>
            <li>
              <strong>Stored in Drive:</strong> summaries (.md + .json), selection sets, and the
              timeline index inside your app folder.
            </li>
            <li>
              <strong>Stored locally:</strong> your current selection list, recent summaries cache,
              and last sync timestamp in your browser.
            </li>
            <li>
              <strong>Cached only:</strong> UI preferences (grouping + filters) stay in your browser.
            </li>
          </ul>
        </Card>

        <Card>
          <h2>Next steps</h2>
          <p className={styles.muted}>After connecting, choose what to summarize.</p>
          <div className={styles.actions}>
            <Button
              variant="secondary"
              disabled={!isSignedIn}
              onClick={() => (window.location.href = '/select/gmail')}
            >
              Select Gmail
            </Button>
            <Button
              variant="secondary"
              disabled={!isSignedIn}
              onClick={() => (window.location.href = '/select/drive')}
            >
              Select Drive
            </Button>
            <Button
              variant="primary"
              disabled={!isSignedIn}
              onClick={() => (window.location.href = '/timeline')}
            >
              Go to Timeline
            </Button>
          </div>
        </Card>

        <Card>
          <h2>App data management</h2>
          <p className={styles.muted}>
            Manage the Drive folder that stores your Timeline artifacts. Deleting removes only app
            data in that folder.
          </p>
          <div className={styles.actions}>
            <Button
              variant="secondary"
              disabled={!driveFolderLink}
              onClick={() => {
                if (driveFolderLink) {
                  window.open(driveFolderLink, '_blank', 'noreferrer');
                }
              }}
            >
              Open app folder in Drive
            </Button>
            <Button
              onClick={handleCleanupPreview}
              variant="secondary"
              disabled={!isSignedIn || !driveFolderId || cleanupLoading}
            >
              {cleanupLoading ? 'Listing...' : 'List app data'}
            </Button>
          </div>
          {cleanupPreview.length > 0 ? (
            <div className={styles.cleanupPanel}>
              <p className={styles.muted}>
                {cleanupPreview.length} file(s) would be deleted. This does not remove your original
                Gmail or Drive files.
              </p>
              <ul className={styles.cleanupList}>
                {cleanupPreview.map((file) => (
                  <li key={file.id}>{file.name}</li>
                ))}
              </ul>
              <label className={styles.confirmRow}>
                <span>Type DELETE to confirm:</span>
                <input
                  className={styles.confirmInput}
                  value={cleanupConfirmText}
                  onChange={(event) => setCleanupConfirmText(event.target.value)}
                />
              </label>
              <Button
                onClick={handleCleanupConfirm}
                variant="secondary"
                className={styles.dangerButton}
                disabled={cleanupLoading || cleanupConfirmText !== 'DELETE'}
              >
                Delete app data in Drive
              </Button>
            </div>
          ) : null}
          {cleanupError ? <p className={styles.error}>{cleanupError}</p> : null}
        </Card>
      </div>
    </section>
  );
}
