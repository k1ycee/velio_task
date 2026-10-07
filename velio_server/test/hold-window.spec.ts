import { holdExpiresAt, holdWindowHours } from '../src/hold-window.js';

const H = 3_600_000;
const booked = new Date('2026-10-07T12:00:00Z');
const at = (hoursOut: number) => new Date(booked.getTime() + hoursOut * H);

describe('holdWindowHours = min(72, remaining / 3)', () => {
  it.each([
    [6, 2],
    [24, 8],
    [71, 23.67],
    [216, 72], // the two formulas meet at 9 days
    [300, 72],
    [0.5, 0.17], // 30 min out → 10 min window
  ])('%sh out → %sh window', (hoursOut, expected) => {
    expect(holdWindowHours(at(hoursOut), booked)).toBeCloseTo(expected, 2);
  });

  it('ignores seconds', () => {
    const withSeconds = new Date(at(6).getTime() + 59_000);
    expect(holdWindowHours(withSeconds, booked)).toBe(holdWindowHours(at(6), booked));
  });

  it('is 0 when the activity has already started', () => {
    expect(holdWindowHours(at(-1), booked)).toBe(0);
  });

  it('holdExpiresAt adds the window to the booking time', () => {
    expect(holdExpiresAt(at(24), booked).toISOString()).toBe('2026-10-07T20:00:00.000Z');
  });
});
