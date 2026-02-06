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

export default function ConnectPageClient({ isConfigured }: ConnectPageClientProps) {
  const { data: session, status, update } = useSession();
  const [provisionState, setProvisionState] = useState<ProvisionState>({ status: 'idle' });

  const scopes = useMemo(() => session?.scopes ?? [], [session?.scopes]);

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

  const connectionLabel = status === 'authenticated' ? 'Signed in' : 'Signed out';
  const lastRefresh = session?.lastTokenRefresh;

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
            disabled={!isConfigured || status === 'authenticated'}
          >
            Connect Google
          </Button>
          <Button
            onClick={() => signOut({ callbackUrl: '/connect' })}
            variant="secondary"
            disabled={status !== 'authenticated'}
          >
            Disconnect
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
              disabled={!isConfigured || status !== 'authenticated' || provisionState.status === 'loading'}
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
        </Card>
      </div>
    </section>
  );
}
