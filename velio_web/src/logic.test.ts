import { describe, expect, it } from 'vitest';
import { applyUpdate } from './live';
import { formatCountdown, holdProgress } from './time';
import { vouchBlockedReason } from './invites';

describe('applyUpdate', () => {
  const start = { '1': { spotsLeft: 5, version: 2 } };

  it('applies a newer version', () => {
    expect(applyUpdate(start, { activityId: '1', spotsLeft: 4, version: 3 })).toEqual({
      '1': { spotsLeft: 4, version: 3 },
    });
  });

  it('drops stale or duplicate versions (out-of-order delivery)', () => {
    expect(applyUpdate(start, { activityId: '1', spotsLeft: 9, version: 2 })).toBe(start);
    expect(applyUpdate(start, { activityId: '1', spotsLeft: 9, version: 1 })).toBe(start);
  });

  it('adds activities it has not seen yet', () => {
    expect(applyUpdate(start, { activityId: '2', spotsLeft: 1, version: 0 })['2']).toEqual({ spotsLeft: 1, version: 0 });
  });
});

describe('formatCountdown', () => {
  it.each([
    [0, 'expired'],
    [-5, 'expired'],
    [59_000, '0m 59s'],
    [3_600_000 + 61_000, '1h 01m'],
    [26 * 3_600_000, '26h 00m'],
  ])('%sms → %s', (ms, text) => expect(formatCountdown(ms)).toBe(text));
});

describe('holdProgress', () => {
  it('is the fraction of the window that has passed, clamped to 0..1', () => {
    const s = new Date('2026-10-07T10:00:00Z');
    const e = new Date('2026-10-07T20:00:00Z');
    expect(holdProgress(s, e, new Date('2026-10-07T15:00:00Z'))).toBe(0.5);
    expect(holdProgress(s, e, new Date('2026-10-07T09:00:00Z'))).toBe(0);
    expect(holdProgress(s, e, new Date('2026-10-07T21:00:00Z'))).toBe(1);
  });
});

describe('vouchBlockedReason', () => {
  const now = new Date('2026-10-08T10:00:00Z');
  const plan = (heldSpotsLeft: number, unusedVouches: number, expiresAt = '2026-10-08T12:00:00Z') => ({
    heldSpotsLeft,
    holdExpiresAt: expiresAt,
    invites: Array.from({ length: unusedVouches }, () => ({ type: 'vouch' as const, used: false })),
  });

  it('allows vouching while an unbound held spot is left', () => {
    expect(vouchBlockedReason(plan(2, 1), now)).toBeNull();
  });

  it('explains a booking made without held spots (the silent-disable bug)', () => {
    expect(vouchBlockedReason(plan(0, 0), now)).toMatch(/no held spots/i);
    expect(vouchBlockedReason(plan(0, 0), now)).toMatch(/public link/i);
  });

  it('explains when the hold window has ended', () => {
    expect(vouchBlockedReason(plan(2, 0, '2026-10-08T09:00:00Z'), now)).toMatch(/hold has ended/i);
  });

  it('explains when every held spot already has a vouch link', () => {
    expect(vouchBlockedReason(plan(2, 2), now)).toMatch(/already has a vouch link/i);
  });
});
