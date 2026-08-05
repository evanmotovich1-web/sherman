import { describe, expect, it } from 'vitest';
import { scoreTrend } from '../src/trending';

const day = 86_400;
const now = 2_000_000_000;
const endorsement = (ownerId: string, createdAt: number, active = true) => ({ ownerId, createdAt, active });

describe('transparent unique-owner consensus', () => {
  it('counts multiple devices belonging to one owner only once', () => {
    expect(scoreTrend([
      endorsement('owner-1', now - 10),
      endorsement('owner-1', now - 5),
    ], { now, issueStatus: 'open' })).toEqual({ uniqueOwners: 1, recentOwners: 1, state: null });
  });

  it('marks three owners in seven days as rising', () => {
    const result = scoreTrend([
      endorsement('owner-1', now - 5 * day),
      endorsement('owner-2', now - 4 * day),
      endorsement('owner-3', now - 2 * day),
    ], { now, issueStatus: 'open' });
    expect(result).toEqual({ uniqueOwners: 3, recentOwners: 0, state: 'rising' });
  });

  it('marks three owners with two new today as viral', () => {
    const result = scoreTrend([
      endorsement('owner-1', now - 3 * day),
      endorsement('owner-2', now - 100),
      endorsement('owner-3', now - 50),
    ], { now, issueStatus: 'open' });
    expect(result).toEqual({ uniqueOwners: 3, recentOwners: 2, state: 'viral' });
  });

  it('excludes withdrawn endorsements and suppresses resolved issues', () => {
    const entries = [
      endorsement('owner-1', now - 100), endorsement('owner-2', now - 90),
      endorsement('owner-3', now - 80, false), endorsement('owner-4', now - 70),
    ];
    expect(scoreTrend(entries, { now, issueStatus: 'resolved' }).state).toBeNull();
    expect(scoreTrend(entries, { now, issueStatus: 'open' }).uniqueOwners).toBe(3);
  });
});
