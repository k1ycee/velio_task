import type { Plan } from './api';

/**
 * Why the booker can't create a vouch link right now, or null if they can.
 * A vouch link reserves one of the plan's held spots, so it needs an open hold
 * with a held spot that no other vouch link has claimed yet.
 */
export function vouchBlockedReason(
  plan: Pick<Plan, 'heldSpotsLeft' | 'holdExpiresAt'> & { invites: Pick<Plan['invites'][number], 'type' | 'used'>[] },
  now: Date,
): string | null {
  if (new Date(plan.holdExpiresAt) <= now) {
    return 'Your hold has ended, so there are no held spots left to vouch with. Share the public link instead.';
  }
  if (plan.heldSpotsLeft === 0) {
    return 'A vouch link saves a held spot for one friend, and this plan has no held spots to give (book with +friends to hold some). Share the public link instead.';
  }
  const pendingVouches = plan.invites.filter((i) => i.type === 'vouch' && !i.used).length;
  if (pendingVouches >= plan.heldSpotsLeft) {
    return 'Every held spot already has a vouch link. Share the public link for anyone else.';
  }
  return null;
}
