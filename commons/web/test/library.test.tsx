import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LiveCommonsClient } from '../src/data/live-client';
import type { ArtifactLibraryItem, CommonsClient } from '../src/data/types';
import { Library } from '../src/routes/Library';

const item: ArtifactLibraryItem = {
  id: 'artifact-1', name: 'synthetic-skill', version: '1.0.0', digestSha256: 'a'.repeat(64), publisherKeyId: 'publisher-1',
  publisherStatus: 'active', compatibility: { node: '>=22' }, files: [{ path: 'SKILL.md', size: 42, sha256: 'b'.repeat(64) }],
  scan: { status: 'passed', scannerVersion: 'scanner-v1', scannedAt: 100, expiresAt: 200, current: true },
  endorsements: { available: false, count: 0 }, changelog: { available: false }, createdAt: 50,
};
const client = (items: ArtifactLibraryItem[]): CommonsClient => ({
  sourceLabel: 'Fixture data — not live Commons', listFeed: () => [], listTrending: () => [], getThread: () => null, listLibrary: () => items,
});

describe('Library', () => {
  it('renders factual verification, compatibility, file, endorsement, and changelog states without claiming safety', async () => {
    render(<Library client={client([item])} />);
    expect(await screen.findByRole('heading', { name: 'synthetic-skill' })).toBeInTheDocument();
    expect(screen.getByText(/passed scan/i)).toBeInTheDocument();
    expect(screen.getByText(/current until/i)).toBeInTheDocument();
    expect(screen.getByText(/node ≥22/i)).toBeInTheDocument();
    expect(screen.getByText(/SKILL\.md/)).toBeInTheDocument();
    expect(screen.getByText(/endorsements unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/changelog unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/safe/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Fixture data — not live Commons/i)).toBeInTheDocument();
  });

  it('shows pending and rejected states without a download control', async () => {
    render(<Library client={client([{ ...item, scan: { status: 'rejected', scannerVersion: 'scanner-v1', scannedAt: 100, expiresAt: 200, current: true } }])} />);
    expect(await screen.findByText(/rejected scan/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /download/i })).not.toBeInTheDocument();
  });

  it('strictly parses live library metadata', async () => {
    const live = new LiveCommonsClient({ fetcher: async () => new Response(JSON.stringify({ artifacts: [{
      id: 'artifact-1', name: 'synthetic-skill', version: '1.0.0', digest_sha256: 'a'.repeat(64), publisher_key_id: 'publisher-1',
      publisher: { status: 'active' }, compatibility: { node: '>=22' }, files: [{ path: 'SKILL.md', size: 42, sha256: 'b'.repeat(64) }],
      scan: { status: 'pending' }, endorsements: { available: false, count: 0 }, changelog: { available: false }, created_at: 50,
    }] }), { headers: { 'content-type': 'application/json' } }) });
    await expect(live.listLibrary()).resolves.toMatchObject([{ name: 'synthetic-skill', scan: { status: 'pending' } }]);
  });
});
