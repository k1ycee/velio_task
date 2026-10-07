const MINUTE = 60_000;
const MAX_WINDOW_MINUTES = 72 * 60;

/**
 * How long a booker has to fill their held spots: min(72h, remaining / 3),
 * in decimal hours. Works in whole minutes, so seconds never matter.
 * Always leaves at least two-thirds of the lead time for released spots to be rebooked.
 */
export function holdWindowHours(activityAt: Date, bookedAt: Date): number {
  const remainingMinutes = Math.floor((activityAt.getTime() - bookedAt.getTime()) / MINUTE);
  if (remainingMinutes <= 0) return 0;
  return Math.min(MAX_WINDOW_MINUTES, Math.floor(remainingMinutes / 3)) / 60;
}

export function holdExpiresAt(activityAt: Date, bookedAt: Date): Date {
  return new Date(bookedAt.getTime() + Math.round(holdWindowHours(activityAt, bookedAt) * 60) * MINUTE);
}
