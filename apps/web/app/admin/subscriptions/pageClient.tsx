'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { ScheduleConfig } from '@timeline/shared';

type RecipientProfile = NonNullable<ScheduleConfig['recipientProfiles']>[number];
type Job = ScheduleConfig['jobs'][number];
type Route = NonNullable<NonNullable<Job['notify']>['routes']>[number];
type Filters = RecipientProfile['filters'];

type TabKey = 'profiles' | 'routing' | 'advanced';

const emptyFilters = (): Filters => ({
  includeActions: true,
  includeDecisions: true,
  includeOpenLoops: true,
  includeRisks: true,
});

const emptyProfile = (): RecipientProfile => ({
  id: '',
  name: '',
  to: [],
  cc: [],
  filters: emptyFilters(),
});

const splitCsv = (value: string) => value.split(',').map((part) => part.trim()).filter(Boolean);
const isEmailLike = (value: string) => value.includes('@') && value.includes('.');
const normalizeTargetKeys = (value: string) => splitCsv(value).map((item) => item.toUpperCase());
const validTargetKey = (key: string) => /^[A-Z0-9_]+$/.test(key);

const filtersToDrilldown = (filters: Filters) => {
  const params = new URLSearchParams();
  if (filters.entities?.[0]) params.set('entity', filters.entities[0]);
  if (filters.tags?.length) params.set('tags', filters.tags.join(','));
  if (filters.participants?.length) params.set('participants', filters.participants.join(','));
  if (filters.kind?.length) params.set('kind', filters.kind.join(','));
  if (filters.riskSeverityMin) params.set('riskSeverity', filters.riskSeverityMin);
  if (filters.includeOpenLoops !== undefined) params.set('hasOpenLoops', String(filters.includeOpenLoops));
  if (filters.includeRisks !== undefined) params.set('hasRisks', String(filters.includeRisks));
  if (filters.includeDecisions !== undefined) params.set('hasDecisions', String(filters.includeDecisions));
  return `/timeline?${params.toString()}`;
};

function FiltersEditor({ value, onChange, prefix }: { value: Filters; onChange: (next: Filters) => void; prefix: string }) {
  return (
    <fieldset>
      <legend>Filters</legend>
      <label htmlFor={`${prefix}-entities`}>Entities (comma separated)</label>
      <input id={`${prefix}-entities`} value={(value.entities ?? []).join(', ')} onChange={(event) => onChange({ ...value, entities: splitCsv(event.target.value) })} />
      <label htmlFor={`${prefix}-tags`}>Tags (comma separated)</label>
      <input id={`${prefix}-tags`} value={(value.tags ?? []).join(', ')} onChange={(event) => onChange({ ...value, tags: splitCsv(event.target.value) })} />
      <label htmlFor={`${prefix}-participants`}>Participants (comma separated)</label>
      <input id={`${prefix}-participants`} value={(value.participants ?? []).join(', ')} onChange={(event) => onChange({ ...value, participants: splitCsv(event.target.value) })} />
      <p>Entities are normalized/aliased on save.</p>
      <div>
        <label>
          <input type="checkbox" checked={(value.kind ?? []).includes('summary')} onChange={(event) => onChange({ ...value, kind: event.target.checked ? Array.from(new Set([...(value.kind ?? []), 'summary'])) : (value.kind ?? []).filter((kind) => kind !== 'summary') })} />
          Summary
        </label>
        <label>
          <input type="checkbox" checked={(value.kind ?? []).includes('synthesis')} onChange={(event) => onChange({ ...value, kind: event.target.checked ? Array.from(new Set([...(value.kind ?? []), 'synthesis'])) : (value.kind ?? []).filter((kind) => kind !== 'synthesis') })} />
          Synthesis
        </label>
      </div>
      <label htmlFor={`${prefix}-risk-sev`}>riskSeverityMin</label>
      <select id={`${prefix}-risk-sev`} value={value.riskSeverityMin ?? ''} onChange={(event) => onChange({ ...value, riskSeverityMin: event.target.value ? (event.target.value as Filters['riskSeverityMin']) : undefined })}>
        <option value="">(unset)</option>
        <option value="low">low</option>
        <option value="medium">medium</option>
        <option value="high">high</option>
      </select>
      <label><input type="checkbox" checked={value.includeOpenLoops ?? true} onChange={(event) => onChange({ ...value, includeOpenLoops: event.target.checked })} />includeOpenLoops</label>
      <label><input type="checkbox" checked={value.includeRisks ?? true} onChange={(event) => onChange({ ...value, includeRisks: event.target.checked })} />includeRisks</label>
      <label><input type="checkbox" checked={value.includeDecisions ?? true} onChange={(event) => onChange({ ...value, includeDecisions: event.target.checked })} />includeDecisions</label>
      <label><input type="checkbox" checked={value.includeActions ?? true} onChange={(event) => onChange({ ...value, includeActions: event.target.checked })} />includeActions</label>
    </fieldset>
  );
}

export default function SubscriptionsPageClient() {
  const [config, setConfig] = useState<ScheduleConfig | null>(null);
  const [initialConfigJson, setInitialConfigJson] = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('profiles');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [newProfile, setNewProfile] = useState<RecipientProfile>(emptyProfile());
  const [previewProfileId, setPreviewProfileId] = useState<string>('');
  const [previewResult, setPreviewResult] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/schedules')
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok) throw new Error(json?.error?.message ?? 'Failed to load schedules');
        setConfig(json.config as ScheduleConfig);
        setInitialConfigJson(JSON.stringify(json.config));
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load schedules');
      });
  }, []);

  const unsaved = useMemo(() => (config ? JSON.stringify(config) !== initialConfigJson : false), [config, initialConfigJson]);

  const updateProfile = (index: number, next: RecipientProfile) => {
    if (!config) return;
    const recipientProfiles = [...(config.recipientProfiles ?? [])];
    recipientProfiles[index] = next;
    setConfig({ ...config, recipientProfiles });
  };

  const addProfile = () => {
    if (!config) return;
    const id = newProfile.id.trim();
    if (!id) {
      setError('Profile id is required.');
      return;
    }
    const to = newProfile.to.filter(Boolean);
    if (!to.length || to.some((email) => !isEmailLike(email))) {
      setError('Profile to list must contain valid emails.');
      return;
    }
    const existing = new Set((config.recipientProfiles ?? []).map((profile) => profile.id));
    if (existing.has(id)) {
      setError(`Profile id already exists: ${id}`);
      return;
    }
    const recipientProfiles = [...(config.recipientProfiles ?? []), { ...newProfile, id, to }];
    setConfig({ ...config, recipientProfiles });
    setNewProfile(emptyProfile());
    setError(null);
  };

  const deleteProfile = (profileId: string) => {
    if (!config) return;
    if (!window.confirm(`Delete profile ${profileId}? Routes referencing it will be removed.`)) return;
    const recipientProfiles = (config.recipientProfiles ?? []).filter((profile) => profile.id !== profileId);
    const jobs = config.jobs.map((job) => {
      if (!job.notify?.routes) return job;
      return {
        ...job,
        notify: {
          ...job.notify,
          routes: job.notify.routes.filter((route) => route.profileId !== profileId),
        },
      };
    });
    setConfig({ ...config, recipientProfiles, jobs });
  };

  const save = async () => {
    if (!config) return;
    for (const job of config.jobs) {
      const channels = job.notify?.channels;
      const keys = [
        ...(channels?.slack?.targets ?? []),
        ...(channels?.webhook?.targets ?? []),
        ...((channels?.slack?.routesTargets ?? []).flatMap((row) => row.targets)),
        ...((channels?.webhook?.routesTargets ?? []).flatMap((row) => row.targets)),
      ];
      if (keys.some((key) => !validTargetKey(key))) {
        setError('Webhook target keys must match A-Z0-9_.');
        return;
      }
    }
    setStatus(null);
    setError(null);
    const response = await fetch('/api/admin/schedules', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(config),
    });
    const json = await response.json();
    if (!response.ok) {
      setError(json?.error?.message ?? 'Failed to save schedule config');
      return;
    }
    setConfig(json.config as ScheduleConfig);
    setInitialConfigJson(JSON.stringify(json.config));
    setStatus('Saved changes.');
  };

  const runPreviewQuery = async () => {
    if (!config || !previewProfileId) return;
    const profile = (config.recipientProfiles ?? []).find((item) => item.id === previewProfileId);
    if (!profile) return;
    const dateToISO = new Date().toISOString();
    const from = new Date();
    from.setDate(from.getDate() - 7);

    const response = await fetch('/api/timeline/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dateFromISO: from.toISOString(),
        dateToISO,
        kind: profile.filters.kind,
        entity: profile.filters.entities?.[0],
        tags: profile.filters.tags,
        participants: profile.filters.participants,
        hasOpenLoops: profile.filters.includeOpenLoops,
        hasRisks: profile.filters.includeRisks,
        hasDecisions: profile.filters.includeDecisions,
        riskSeverity: profile.filters.riskSeverityMin,
        limitArtifacts: 10,
      }),
    });
    const json = await response.json();
    if (!response.ok) {
      setPreviewResult(json?.error?.message ?? 'Preview query failed');
      return;
    }
    setPreviewResult(`artifacts=${json.totals.artifactsMatched}, openLoops=${json.totals.openLoopsMatched}, risks=${json.totals.risksMatched}, decisions=${json.totals.decisionsMatched}`);
  };

  const selectedProfile = (config?.recipientProfiles ?? []).find((item) => item.id === previewProfileId);

  if (!config) {
    return <p>{error ?? 'Loading...'}</p>;
  }

  return (
    <div>
      <div>
        <button type="button" onClick={() => setActiveTab('profiles')}>Recipient Profiles</button>
        <button type="button" onClick={() => setActiveTab('routing')}>Job Routing & Notify Settings</button>
        <button type="button" onClick={() => setActiveTab('advanced')}>Advanced JSON</button>
      </div>

      {unsaved ? <p>Unsaved changes</p> : null}
      {status ? <p>{status}</p> : null}
      {error ? <p>{error}</p> : null}

      {activeTab === 'profiles' ? (
        <section>
          <h2>Recipient Profiles</h2>
          {(config.recipientProfiles ?? []).map((profile, profileIndex) => (
            <article key={profile.id}>
              <h3>{profile.id}</h3>
              <p>Profile ID is immutable after creation.</p>
              <label>Name
                <input value={profile.name ?? ''} onChange={(event) => updateProfile(profileIndex, { ...profile, name: event.target.value })} />
              </label>
              <label>To emails (comma separated)
                <input value={profile.to.join(', ')} onChange={(event) => updateProfile(profileIndex, { ...profile, to: splitCsv(event.target.value) })} />
              </label>
              <label>CC emails (comma separated)
                <input value={(profile.cc ?? []).join(', ')} onChange={(event) => updateProfile(profileIndex, { ...profile, cc: splitCsv(event.target.value) })} />
              </label>
              <FiltersEditor value={profile.filters} onChange={(filters) => updateProfile(profileIndex, { ...profile, filters })} prefix={`profile-${profile.id}`} />
              <button type="button" onClick={() => deleteProfile(profile.id)}>Delete profile</button>
            </article>
          ))}

          <h3>Add profile</h3>
          <label>Id
            <input value={newProfile.id} onChange={(event) => setNewProfile({ ...newProfile, id: event.target.value.trim().slice(0, 40) })} />
          </label>
          <label>Name
            <input value={newProfile.name ?? ''} onChange={(event) => setNewProfile({ ...newProfile, name: event.target.value })} />
          </label>
          <label>To emails (comma separated)
            <input value={newProfile.to.join(', ')} onChange={(event) => setNewProfile({ ...newProfile, to: splitCsv(event.target.value) })} />
          </label>
          <label>CC emails (comma separated)
            <input value={(newProfile.cc ?? []).join(', ')} onChange={(event) => setNewProfile({ ...newProfile, cc: splitCsv(event.target.value) })} />
          </label>
          <FiltersEditor value={newProfile.filters} onChange={(filters) => setNewProfile({ ...newProfile, filters })} prefix="new-profile" />
          <button type="button" onClick={addProfile}>Add profile</button>

          <h3>Preview</h3>
          <label>Profile
            <select value={previewProfileId} onChange={(event) => setPreviewProfileId(event.target.value)}>
              <option value="">Select profile</option>
              {(config.recipientProfiles ?? []).map((profile) => <option key={profile.id} value={profile.id}>{profile.id}</option>)}
            </select>
          </label>
          {selectedProfile ? (
            <div>
              <p>Filters summary: {JSON.stringify(selectedProfile.filters)}</p>
              <p>Sample drilldown URL: {filtersToDrilldown(selectedProfile.filters)}</p>
              <button type="button" onClick={runPreviewQuery}>Run preview query</button>
              {previewResult ? <p>{previewResult}</p> : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {activeTab === 'routing' ? (
        <section>
          <h2>Job Routing & Notify Settings</h2>
          {config.jobs.map((job, jobIndex) => {
            const notify: NonNullable<Job['notify']> = job.notify ?? {
              enabled: false,
              mode: 'broadcast',
              to: [],
              generatePerRouteReport: false,
              maxPerRouteReportsPerRun: 5,
            };
            const mode = notify.mode ?? 'broadcast';
            const routes = notify.routes ?? [];
            const usedProfileIds = new Set(routes.map((route) => route.profileId));

            const updateJob = (nextJob: Job) => {
              const jobs = [...config.jobs];
              jobs[jobIndex] = nextJob;
              setConfig({ ...config, jobs });
            };

            const upsertNotify = (nextNotify: NonNullable<Job['notify']>) => updateJob({ ...job, notify: nextNotify } as Job);

            return (
              <article key={job.id}>
                <h3>{job.id} ({job.type})</h3>
                <label>
                  <input type="checkbox" checked={job.enabled} onChange={(event) => updateJob({ ...job, enabled: event.target.checked })} />
                  enabled
                </label>
                <label>Cron
                  <input value={job.schedule.cron} onChange={(event) => updateJob({ ...job, schedule: { ...job.schedule, cron: event.target.value } })} />
                </label>
                <label>Timezone
                  <input value={job.schedule.timezone} onChange={(event) => updateJob({ ...job, schedule: { ...job.schedule, timezone: event.target.value } })} />
                </label>
                <label>
                  <input type="checkbox" checked={notify.enabled} onChange={(event) => upsertNotify({ ...notify, enabled: event.target.checked })} />
                  notify.enabled
                </label>
                <label>notify.mode
                  <select aria-label={`notify mode ${job.id}`} value={mode} onChange={(event) => upsertNotify({ ...notify, mode: event.target.value as 'broadcast' | 'routes' })}>
                    <option value="broadcast">broadcast</option>
                    <option value="routes">routes</option>
                  </select>
                </label>

                <label>subjectPrefix
                  <input value={notify.subjectPrefix ?? ''} onChange={(event) => upsertNotify({ ...notify, subjectPrefix: event.target.value })} />
                </label>
                <label><input type="checkbox" checked={notify.sendWhenEmpty ?? false} onChange={(event) => upsertNotify({ ...notify, sendWhenEmpty: event.target.checked })} />sendWhenEmpty</label>
                <label><input type="checkbox" checked={notify.includeLinks ?? true} onChange={(event) => upsertNotify({ ...notify, includeLinks: event.target.checked })} />includeLinks</label>
                <p>Targets are env keys like TEAM_A; configure SLACK_WEBHOOK_TEAM_A in deployment env.</p>
                <label>
                  <input
                    type="checkbox"
                    checked={notify.channels?.slack?.enabled ?? false}
                    onChange={(event) => upsertNotify({ ...notify, channels: { ...(notify.channels ?? {}), slack: { ...(notify.channels?.slack ?? {}), enabled: event.target.checked } } })}
                  />
                  Slack enabled
                </label>
                <label>Slack targets (comma separated keys)
                  <input value={(notify.channels?.slack?.targets ?? []).join(', ')} onChange={(event) => upsertNotify({ ...notify, channels: { ...(notify.channels ?? {}), slack: { ...(notify.channels?.slack ?? { enabled: true }), targets: normalizeTargetKeys(event.target.value) } } })} />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={notify.channels?.webhook?.enabled ?? false}
                    onChange={(event) => upsertNotify({ ...notify, channels: { ...(notify.channels ?? {}), webhook: { ...(notify.channels?.webhook ?? {}), enabled: event.target.checked } } })}
                  />
                  Webhook enabled
                </label>
                <label>Webhook targets (comma separated keys)
                  <input value={(notify.channels?.webhook?.targets ?? []).join(', ')} onChange={(event) => upsertNotify({ ...notify, channels: { ...(notify.channels ?? {}), webhook: { ...(notify.channels?.webhook ?? { enabled: true }), targets: normalizeTargetKeys(event.target.value) } } })} />
                </label>

                {mode === 'broadcast' ? (
                  <div>
                    <label>To emails
                      <input value={(notify.to ?? []).join(', ')} onChange={(event) => upsertNotify({ ...notify, to: splitCsv(event.target.value) })} />
                    </label>
                    <label>CC emails
                      <input value={(notify.cc ?? []).join(', ')} onChange={(event) => upsertNotify({ ...notify, cc: splitCsv(event.target.value) })} />
                    </label>
                  </div>
                ) : (
                  <div>
                    {notify.enabled && routes.length === 0 ? <p>This job has no routes.</p> : null}
                    {routes.map((route, routeIndex) => (
                      <div key={`${job.id}-route-${routeIndex}`}>
                        <label>Profile
                          <select value={route.profileId} onChange={(event) => {
                            const nextProfile = event.target.value;
                            if (routes.some((existing, idx) => idx !== routeIndex && existing.profileId === nextProfile)) return;
                            const nextRoutes = [...routes];
                            nextRoutes[routeIndex] = { ...route, profileId: nextProfile };
                            upsertNotify({ ...notify, routes: nextRoutes });
                          }}>
                            {(config.recipientProfiles ?? []).map((profile) => <option key={profile.id} value={profile.id}>{profile.id}</option>)}
                          </select>
                        </label>
                        <label>Route subjectPrefix
                          <input value={route.subjectPrefix ?? ''} onChange={(event) => {
                            const nextRoutes = [...routes];
                            nextRoutes[routeIndex] = { ...route, subjectPrefix: event.target.value };
                            upsertNotify({ ...notify, routes: nextRoutes });
                          }} />
                        </label>
                        <label>Override Slack targets (comma separated keys)
                          <input value={(notify.channels?.slack?.routesTargets?.find((row) => row.profileId === route.profileId)?.targets ?? []).join(', ')} onChange={(event) => {
                            const existing = notify.channels?.slack?.routesTargets ?? [];
                            const rest = existing.filter((row) => row.profileId !== route.profileId);
                            upsertNotify({ ...notify, channels: { ...(notify.channels ?? {}), slack: { ...(notify.channels?.slack ?? { enabled: true }), routesTargets: [...rest, { profileId: route.profileId, targets: normalizeTargetKeys(event.target.value) }] } } });
                          }} />
                        </label>
                        <label>Override Webhook targets (comma separated keys)
                          <input value={(notify.channels?.webhook?.routesTargets?.find((row) => row.profileId === route.profileId)?.targets ?? []).join(', ')} onChange={(event) => {
                            const existing = notify.channels?.webhook?.routesTargets ?? [];
                            const rest = existing.filter((row) => row.profileId !== route.profileId);
                            upsertNotify({ ...notify, channels: { ...(notify.channels ?? {}), webhook: { ...(notify.channels?.webhook ?? { enabled: true }), routesTargets: [...rest, { profileId: route.profileId, targets: normalizeTargetKeys(event.target.value) }] } } });
                          }} />
                        </label>
                        <label>
                          <input type="checkbox" checked={Boolean(route.filtersOverride)} onChange={(event) => {
                            const nextRoutes = [...routes];
                            nextRoutes[routeIndex] = { ...route, filtersOverride: event.target.checked ? (route.filtersOverride ?? emptyFilters()) : undefined };
                            upsertNotify({ ...notify, routes: nextRoutes });
                          }} />
                          Override filters
                        </label>
                        {route.filtersOverride ? (
                          <FiltersEditor prefix={`${job.id}-route-${routeIndex}`} value={route.filtersOverride} onChange={(filtersOverride) => {
                            const nextRoutes = [...routes];
                            nextRoutes[routeIndex] = { ...route, filtersOverride };
                            upsertNotify({ ...notify, routes: nextRoutes });
                          }} />
                        ) : null}
                      </div>
                    ))}
                    <button type="button" onClick={() => {
                      const candidate = (config.recipientProfiles ?? []).find((profile) => !usedProfileIds.has(profile.id));
                      if (!candidate) return;
                      const nextRoutes: Route[] = [...routes, { profileId: candidate.id }];
                      upsertNotify({ ...notify, routes: nextRoutes });
                    }}>Add route</button>

                    <label><input type="checkbox" checked={notify.generatePerRouteReport ?? false} onChange={(event) => upsertNotify({ ...notify, generatePerRouteReport: event.target.checked })} />generatePerRouteReport</label>
                    <label>maxPerRouteReportsPerRun
                      <input type="number" value={notify.maxPerRouteReportsPerRun ?? 5} min={1} max={25} onChange={(event) => upsertNotify({ ...notify, maxPerRouteReportsPerRun: Number(event.target.value) })} />
                    </label>
                    <label>reportTitleTemplate
                      <input value={notify.reportTitleTemplate ?? ''} onChange={(event) => upsertNotify({ ...notify, reportTitleTemplate: event.target.value })} />
                    </label>
                  </div>
                )}
              </article>
            );
          })}
        </section>
      ) : null}

      {activeTab === 'advanced' ? (
        <section>
          <h2>Advanced JSON</h2>
          <p>Use the existing JSON editor for advanced updates.</p>
          <Link href="/admin/schedules">Open JSON schedule editor</Link>
        </section>
      ) : null}

      <button type="button" onClick={save}>Save changes</button>
    </div>
  );
}
