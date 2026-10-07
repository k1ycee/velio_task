import type { Activity } from './api';
import { currentSpotsLeft, type Counts } from './live';

/** Live "N of M left", using whichever is newer: the loaded activity or the stream. */
export function SpotsLeft({ activity, counts }: { activity: Activity; counts: Counts }) {
  const spotsLeft = currentSpotsLeft(activity, counts);
  const tone = spotsLeft === 0 ? 'soldout' : spotsLeft <= Math.max(1, Math.floor(activity.capacity / 5)) ? 'low' : '';
  return (
    <span className={`spots ${tone}`} aria-live="polite">
      {spotsLeft === 0 ? 'Sold out' : `${spotsLeft} of ${activity.capacity} left`}
    </span>
  );
}

