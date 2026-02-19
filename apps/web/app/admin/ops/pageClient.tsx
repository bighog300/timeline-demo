'use client';

import React, { useEffect, useState } from 'react';
import { useCallback } from 'react';

import type { OpsStatus } from '../../lib/ops/schemas';
import { getAuthRemediation } from '../../lib/ops/remediationText';

export default function OpsPageClient() {
  const [status, setStatus] = useState<OpsStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [unmutingKey, setUnmutingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setUnauthorized = () => {
    setError('Not authorized / Admin only.');
  };

  const load = useCallback(async () => {
    const response = await fetch('/api/admin/ops/status');
    if (response.status === 401 || response.status === 403) {
      setUnauthorized();
      return;
    }
    const json = await response.json();
    if (response.ok) {
      setError(null);
      setStatus(json as OpsStatus);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onRunNow = async () => {
    setRunning(true);
    const response = await fetch('/api/admin/ops/run-now', { method: 'POST' });
    if (response.status === 401 || response.status === 403) {
      setUnauthorized();
      setRunning(false);
      return;
    }
    await load();
    setRunning(false);
  };


  const onUnmute = async (target: { channel: 'email' | 'slack' | 'webhook'; targetKey?: string; recipientKey?: string }) => {
    const key = `${target.channel}:${target.targetKey ?? target.recipientKey ?? ''}`;
    setUnmutingKey(key);
    const response = await fetch('/api/admin/ops/targets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'unmute', channel: target.channel, targetKey: target.targetKey, recipientKey: target.recipientKey }),
    });
    if (response.status === 401 || response.status === 403) {
      setUnauthorized();
      setUnmutingKey(null);
      return;
    }
    await load();
    setUnmutingKey(null);
  };

  const auth = status?.issues.auth;
  const remediation = getAuthRemediation({ missingRefreshToken: Boolean(auth?.missingRefreshToken), insufficientScope: Boolean(auth?.insufficientScope) });

  return (
    <div>
      {error ? <p>{error}</p> : null}
      <section>
        <h2>Scheduler Health</h2>
        <p>Lock held: {status?.scheduler.lock.held ? 'Yes' : 'No'}</p>
        <p>Last cron run: {status?.scheduler.lastCronRunISO ?? 'Never'}</p>
        <button type="button" disabled={running} onClick={onRunNow}>Run now</button>
      </section>

      <section>
        <h2>Jobs</h2>
        <table><tbody>{(status?.jobs ?? []).map((job) => <tr key={job.jobId}><td>{job.jobId}</td><td>{job.type}</td><td>{job.lastRun?.ok ? 'ok' : 'fail'}</td><td>{job.issues?.join(', ')}</td></tr>)}</tbody></table>
      </section>


      <section>
        <h2>Muted targets</h2>
        <ul>
          {(status?.issues.mutedTargets ?? []).map((target) => {
            const key = `${target.channel}:${target.targetKey ?? target.recipientKey ?? ''}`;
            return (
              <li key={key}>
                {target.channel} {target.targetKey ?? target.recipientKey} until {target.mutedUntilISO ?? 'unknown'} ({target.reason ?? 'muted'})
                <button type="button" disabled={unmutingKey === key} onClick={() => onUnmute(target)}>Unmute</button>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2>Issues</h2>
        <p>Missing Slack keys: {(status?.issues.missingEnvTargets.slack ?? []).join(', ') || 'none'}</p>
        <p>Missing Webhook keys: {(status?.issues.missingEnvTargets.webhook ?? []).join(', ') || 'none'}</p>
        {(auth?.missingRefreshToken || auth?.insufficientScope) ? (
          <div>
            <h3>{remediation.title}</h3>
            <ul>{remediation.steps.map((step) => <li key={step}>{step}</li>)}</ul>
          </div>
        ) : null}
        <ul>{(status?.issues.recentFailures ?? []).slice(0, 20).map((failure, index) => <li key={`${failure.tsISO}-${index}`}>{failure.tsISO} {failure.jobId} {failure.channel} {failure.targetKey} {failure.status} {failure.code} {failure.message}</li>)}</ul>
      </section>
    </div>
  );
}
