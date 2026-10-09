import type { Activity } from './api';
import { currentSpotsLeft, type Counts } from './live';

export type Tab = 'all' | 'week' | 'weekend' | 'spots';

export const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'week', label: 'This week' },
  { id: 'weekend', label: 'This weekend' },
  { id: 'spots', label: 'Has spots' },
];

const DAY = 24 * 60 * 60 * 1000;

/** The coming weekend in local time: Saturday 00:00 to Monday 00:00 (the current one on Sat/Sun). */
export function weekendRange(now: Date): [Date, Date] {
  const day = now.getDay(); // 0 = Sunday
  const saturday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (day === 0 ? -1 : 6 - day));
  return [saturday, new Date(saturday.getFullYear(), saturday.getMonth(), saturday.getDate() + 2)];
}

// ponytail: search is a client-side title match over GET /activities; move it to the server
// (and add location, planned for v2) once the list is too long to load in one request.
export function filterActivities(activities: Activity[], query: string, tab: Tab, counts: Counts, now: Date) {
  const q = query.trim().toLowerCase();
  const [weekendStart, weekendEnd] = weekendRange(now);
  return activities.filter((a) => {
    if (q && !a.title.toLowerCase().includes(q)) return false;
    const starts = new Date(a.startsAt).getTime();
    switch (tab) {
      case 'week':
        return starts < now.getTime() + 7 * DAY;
      case 'weekend':
        return starts >= weekendStart.getTime() && starts < weekendEnd.getTime();
      case 'spots':
        return currentSpotsLeft(a, counts) > 0;
      default:
        return true;
    }
  });
}

/** A stable cover gradient per activity, so cards are recognisable without uploaded images. */
const COVERS = [
  ['#1f1535', '#3657f5'],
  ['#212121', '#6a3fd6'],
  ['#1f1535', '#0f8a6c'],
  ['#212121', '#0e7490'],
];
export function coverFor(id: string): string {
  const [from, to] = COVERS[Number(id) % COVERS.length] ?? COVERS[0];
  return `linear-gradient(135deg, ${from}, ${to})`;
}

/** "You + 2 friends" / "Book just me": who a booking covers, in words, so "Book 1" never has to be decoded. */
const friends = (held: number) => `${held} friend${held === 1 ? '' : 's'}`;
export const friendsLabel = (held: number) => `You + ${friends(held)}`;
export const bookLabel = (held: number) => (held === 0 ? 'Book just me' : `Book you + ${friends(held)}`);
