import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TrendBadge } from '../src/components/TrendBadge';
import type { TrendIssue } from '../src/data/types';
import '../src/styles/tokens.css';

const owners = ['Evan', 'Maya', 'Noah'] as const;

function TrendFixture() {
  const [enrolled, setEnrolled] = useState<Set<string>>(() => new Set());
  const [complaints, setComplaints] = useState<Set<string>>(() => new Set());
  const count = complaints.size;
  const trend: TrendIssue | null = count >= 2 ? {
    issueKey: 'fixture-scroll-history',
    title: 'Wheel history is inaccessible',
    state: count >= 3 ? 'viral' : 'rising',
    uniqueOwners: count,
    recentOwners: count,
    summary: 'Distinct fixture-owner complaints under one issue key.',
    velocity: [],
  } : null;

  const add = (current: Set<string>, owner: string) => new Set([...current, owner]);

  return (
    <main className="route-shell">
      <p className="eyebrow">E2E fixture only</p>
      <h1>Distinct-owner trend scenario</h1>
      <p className="source-notice">Fixture preview — not live API data</p>
      <section aria-label="Fixture enrollment">
        {owners.map((owner) => (
          <button key={`enroll-${owner}`} disabled={enrolled.has(owner)} onClick={() => setEnrolled(add(enrolled, owner))}>
            Enroll {owner}
          </button>
        ))}
      </section>
      <section aria-label="Fixture complaints">
        {owners.map((owner) => (
          <button key={`submit-${owner}`} disabled={!enrolled.has(owner) || complaints.has(owner)} onClick={() => setComplaints(add(complaints, owner))}>
            Submit {owner} complaint
          </button>
        ))}
      </section>
      <article className="trend-card" aria-label="Trend result">
        <div className="trend-copy">
          <h2>Wheel history is inaccessible</h2>
          {trend ? <TrendBadge trend={trend} /> : <p>No trend: {count} {count === 1 ? 'owner' : 'owners'}</p>}
        </div>
      </article>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<TrendFixture />);
