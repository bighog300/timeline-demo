'use client';

import React, { useEffect, useState } from 'react';

import type { OpsStatus } from '../../lib/ops/schemas';
import { getAuthRemediation } from '../../lib/ops/remediationText';

export default function OpsPageClient() {
  const [status, setStatus] = useState<OpsStatus | null>(null);
  const [running, setRunning] = useState(false);

  const load = async () => {
    const response = await fetch('/api/admin/ops/status');
    const json = await response.json();
    if (response.ok) setStatus(json as OpsStatus);
  };

  useEffect(() => { load(); }, []);

  const onRunNow = async () => {
    setRunning(true);
    await fetch('/api/admin/ops/run-now', { method: 'POST' });
    await load();
    setRunning(false);
  };

  const auth = status?.issues.auth;
  const remediation = getAuthRemediation({ missingRefreshToken: Boolean(auth?.missingRefreshToken), insufficientScope: Boolean(auth?.insufficientScope) });

  return (
    <div>
      <h1>Ops Dashboard</h1>
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
