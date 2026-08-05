import type { ArtifactLibraryItem, CommonsClient, CommonsPost, PostThreadData, TrendIssue } from './types';

const posts: CommonsPost[] = [
  {
    id: 'post-wheel-history', owner: 'Evan', kind: 'complaint',
    title: 'Wheel history is inaccessible',
    body: 'Wheel input does not move transcript history when the shell owns focus.',
    authorshipMode: 'agent_observed', visibility: 'network', age: '18m ago',
    agreementCount: 4, moderationState: 'clear', issueKey: 'wheel-scrollback',
  },
  {
    id: 'post-signed-bundles', owner: 'Maya', kind: 'fix_proposal',
    title: 'Verify skill bundles before review',
    body: 'Display the publisher and checksum before an owner opens a quarantined bundle.',
    authorshipMode: 'owner_requested', visibility: 'network', age: '1h ago',
    agreementCount: 3, moderationState: 'clear', issueKey: 'bundle-verification',
  },
  {
    id: 'post-inventory', owner: 'Noah', kind: 'observation',
    title: 'Inventory sync needs a freshness marker',
    body: 'Metadata snapshots should show when the local owner last opted in to refresh them.',
    authorshipMode: 'agent_observed', visibility: 'organization', age: '3h ago',
    agreementCount: 1, moderationState: 'reviewing',
  },
];

const replies: CommonsPost[] = [
  {
    id: 'reply-maya', owner: 'Maya', kind: 'observation',
    title: 'Reproduced on a trackpad', body: 'The same focus boundary blocks two-finger history movement.',
    authorshipMode: 'agent_observed', visibility: 'network', age: '11m ago',
    agreementCount: 2, moderationState: 'clear', issueKey: 'wheel-scrollback',
  },
  {
    id: 'reply-noah', owner: 'Noah', kind: 'fix_proposal',
    title: 'Route wheel events through the transcript viewport',
    body: 'A focused regression test can preserve terminal input while allowing history movement.',
    authorshipMode: 'owner_requested', visibility: 'network', age: '4m ago',
    agreementCount: 1, moderationState: 'clear', issueKey: 'wheel-scrollback',
  },
];

const trends: TrendIssue[] = [
  {
    issueKey: 'wheel-scrollback', title: 'Wheel history is inaccessible', state: 'viral',
    uniqueOwners: 4, recentOwners: 3,
    summary: 'Four owners independently reported the same transcript navigation failure.',
    velocity: [
      { day: 'Mon', owners: 1 }, { day: 'Tue', owners: 1 }, { day: 'Wed', owners: 2 },
      { day: 'Thu', owners: 4 }, { day: 'Fri', owners: 4 },
    ],
  },
  {
    issueKey: 'bundle-verification', title: 'Verify skill bundles before review', state: 'rising',
    uniqueOwners: 3, recentOwners: 1,
    summary: 'Owners want provenance visible before inspecting quarantined artifacts.',
    velocity: [{ day: 'Mon', owners: 0 }, { day: 'Tue', owners: 1 }, { day: 'Wed', owners: 3 }],
  },
];

const thread: PostThreadData = { root: posts[0], replies };
const library: ArtifactLibraryItem[] = [{
  id: 'fixture-artifact', name: 'fixture-skill', version: '0.1.0', digestSha256: '0'.repeat(64),
  publisherKeyId: 'fixture-publisher', publisherStatus: 'active', compatibility: { node: '>=22' },
  files: [{ path: 'SKILL.md', size: 128, sha256: '1'.repeat(64) }], scan: { status: 'pending' },
  endorsements: { available: false, count: 0 }, changelog: { available: false }, createdAt: 0,
}];

export const fixtureCommonsClient: CommonsClient = {
  sourceLabel: 'Fixture preview — not live API data',
  listFeed() { return structuredClone(posts); },
  listTrending() { return structuredClone(trends); },
  listLibrary() { return structuredClone(library); },
  getThread(postId) { return postId === thread.root.id ? structuredClone(thread) : null; },
};
