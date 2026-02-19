import { describe, expect, it } from 'vitest';

import { emptyCircuitBreakers, getCircuitState, recordSendFailure, recordSendSuccess } from './circuitBreaker';

describe('circuitBreaker', () => {
  it('mutes after threshold', () => {
    const state = emptyCircuitBreakers();
    const now = new Date('2026-01-01T00:00:00Z');
    recordSendFailure({ state, target: { channel: 'slack', targetKey: 'TEAM_A' }, error: { message: 'x' }, now });
    recordSendFailure({ state, target: { channel: 'slack', targetKey: 'TEAM_A' }, error: { message: 'x' }, now: new Date('2026-01-01T00:05:00Z') });
    recordSendFailure({ state, target: { channel: 'slack', targetKey: 'TEAM_A' }, error: { message: 'x' }, now: new Date('2026-01-01T00:10:00Z') });

    expect(getCircuitState(state, { channel: 'slack', targetKey: 'TEAM_A' }, new Date('2026-01-01T00:11:00Z')).muted).toBe(true);
  });

  it('success resets mute/failures', () => {
    const state = emptyCircuitBreakers();
    recordSendFailure({ state, target: { channel: 'email', recipientKey: 'broadcast' }, error: { message: 'x' }, now: new Date('2026-01-01T00:00:00Z') });
    recordSendFailure({ state, target: { channel: 'email', recipientKey: 'broadcast' }, error: { message: 'x' }, now: new Date('2026-01-01T00:01:00Z') });
    recordSendFailure({ state, target: { channel: 'email', recipientKey: 'broadcast' }, error: { message: 'x' }, now: new Date('2026-01-01T00:02:00Z') });
    recordSendSuccess({ state, target: { channel: 'email', recipientKey: 'broadcast' } });

    const status = getCircuitState(state, { channel: 'email', recipientKey: 'broadcast' }, new Date('2026-01-01T00:03:00Z'));
    expect(status.muted).toBe(false);
  });
});
