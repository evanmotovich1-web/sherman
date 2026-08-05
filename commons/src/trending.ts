export type EndorsementSignal = {
  ownerId: string;
  createdAt: number;
  active: boolean;
};

export type TrendState = 'emerging' | 'rising' | 'viral' | null;

export function scoreTrend(
  endorsements: EndorsementSignal[],
  options: { now: number; issueStatus: 'open' | 'resolved' | 'suppressed' },
): { uniqueOwners: number; recentOwners: number; state: TrendState } {
  const sevenDaysAgo = options.now - 7 * 86_400;
  const oneDayAgo = options.now - 86_400;
  const active = endorsements.filter((entry) => entry.active && entry.createdAt >= sevenDaysAgo);
  const uniqueOwners = new Set(active.map((entry) => entry.ownerId)).size;
  const recentOwners = new Set(active.filter((entry) => entry.createdAt >= oneDayAgo).map((entry) => entry.ownerId)).size;
  let state: TrendState = null;
  if (options.issueStatus === 'open') {
    if (uniqueOwners >= 3 && recentOwners >= 2) state = 'viral';
    else if (uniqueOwners >= 3) state = 'rising';
    else if (uniqueOwners === 2) state = 'emerging';
  }
  return { uniqueOwners, recentOwners, state };
}
