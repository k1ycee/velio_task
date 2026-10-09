import { describe, expect, it } from 'vitest';
import { applyUpdate } from './live';
import { formatCountdown, holdProgress } from './time';
import { vouchBlockedReason } from './invites';
import { bookLabel, filterActivities, friendsLabel, weekendRange } from './discover';
import type { Activity } from './api';

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

describe('filterActivities', () => {
  const now = new Date(2026, 9, 8, 12, 0); // Thursday 8 Oct 2026, local time
  const at = (d: number, h = 18) => new Date(2026, 9, d, h).toISOString();
  const act = (id: string, title: string, startsAt: string, spotsLeft = 3): Activity => ({
    id, hostId: '1', title, startsAt, capacity: 10, spotsLeft, version: 1,
  });
  const list = [
    act('1', 'Sunset Kayak', at(9)), // Friday
    act('2', 'Board games', at(10)), // Saturday
    act('3', 'Kayak lessons', at(20), 0), // in 12 days, sold out
  ];
  const ids = (q: string, tab: Parameters<typeof filterActivities>[2], counts = {}) =>
    filterActivities(list, q, tab, counts, now).map((a) => a.id);

  it('matches the title case-insensitively and ignores surrounding spaces', () => {
    expect(ids('  KAYAK ', 'all')).toEqual(['1', '3']);
    expect(ids('', 'all')).toEqual(['1', '2', '3']);
  });

  it('filters by this week, this weekend and has spots', () => {
    expect(ids('', 'week')).toEqual(['1', '2']);
    expect(ids('', 'weekend')).toEqual(['2']);
    expect(ids('', 'spots')).toEqual(['1', '2']);
  });

  it('uses the live count for "has spots" when it is newer', () => {
    expect(ids('', 'spots', { '2': { spotsLeft: 0, version: 2 } })).toEqual(['1']);
  });

  it('treats Sunday as part of the current weekend', () => {
    const [start, end] = weekendRange(new Date(2026, 9, 11, 9)); // Sunday
    expect(start).toEqual(new Date(2026, 9, 10));
    expect(end).toEqual(new Date(2026, 9, 12));
  });
});

describe('booking labels', () => {
  it('says who the booking covers instead of a bare count', () => {
    expect(bookLabel(0)).toBe('Book just me');
    expect(bookLabel(1)).toBe('Book you + 1 friend');
    expect(bookLabel(3)).toBe('Book you + 3 friends');
    expect(friendsLabel(2)).toBe('You + 2 friends');
  });
});
