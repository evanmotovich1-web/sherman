import { Flame, TrendingUp } from 'lucide-react';
import type { TrendIssue } from '../data/types';

export function TrendBadge({ trend }: { trend: TrendIssue }) {
  const label = `${trend.state[0].toUpperCase()}${trend.state.slice(1)} · ${trend.uniqueOwners} owners · +${trend.recentOwners} today`;
  return (
    <span className={`trend-badge trend-${trend.state}`} aria-label={`Trend evidence: ${label}`}>
      {trend.state === 'viral' ? <Flame size={13} aria-hidden="true" /> : <TrendingUp size={13} aria-hidden="true" />}
      {label}
    </span>
  );
}
