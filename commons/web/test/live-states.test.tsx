import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { LiveClientError } from '../src/data/live-client';
import type { CommonsClient, CommonsPost } from '../src/data/types';

const livePost: CommonsPost = {
  id: 'live-1', owner: 'Live Owner', kind: 'idea', title: 'Loaded live', body: 'API body',
  authorshipMode: 'owner_requested', visibility: 'network', age: 'just now', agreementCount: 0,
  moderationState: 'clear',
};

function mockClient(overrides: Partial<CommonsClient> = {}): CommonsClient {
  return {
    sourceLabel: 'Live Commons API — read only',
    listFeed: vi.fn(async () => [livePost]),
    listTrending: vi.fn(async () => []),
    listLibrary: vi.fn(async () => []),
    getThread: vi.fn(async () => null),
    ...overrides,
  };
}

describe('live dashboard states', () => {
  it('announces feed loading and renders typed live success', async () => {
    let resolve!: (posts: CommonsPost[]) => void;
    const client = mockClient({ listFeed: vi.fn(() => new Promise<CommonsPost[]>((done) => { resolve = done; })) });
    render(<App client={client} initialPath="/" />);

    expect(await screen.findByRole('status', { name: /loading feed/i })).toBeInTheDocument();
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    resolve([livePost]);
    expect(await screen.findByRole('heading', { name: 'Loaded live' })).toBeInTheDocument();
    expect(screen.getByText('Live Commons API — read only')).toBeInTheDocument();
  });

  it('shows a generic feed error, never fixture fallback, and retries', async () => {
    const listFeed = vi.fn()
      .mockRejectedValueOnce(new LiveClientError('access'))
      .mockResolvedValueOnce([livePost]);
    render(<App client={mockClient({ listFeed })} initialPath="/" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Commons access is unavailable.');
    expect(screen.queryByText('Wheel history is inaccessible')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry feed' }));
    expect(await screen.findByRole('heading', { name: 'Loaded live' })).toBeInTheDocument();
    expect(listFeed).toHaveBeenCalledTimes(2);
  });

  it('renders an accessible empty feed state', async () => {
    render(<App client={mockClient({ listFeed: vi.fn(async () => []) })} initialPath="/" />);
    expect(await screen.findByRole('status', { name: /feed is empty/i })).toHaveTextContent('No posts are visible');
  });

  it('renders loading and empty states for trending', async () => {
    let resolve!: (issues: []) => void;
    const client = mockClient({ listTrending: vi.fn(() => new Promise<[]>((done) => { resolve = done; })) });
    render(<App client={client} initialPath="/trending" />);
    expect(await screen.findByRole('status', { name: /loading trending/i })).toBeInTheDocument();
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    resolve([]);
    expect(await screen.findByRole('status', { name: /trending is empty/i })).toHaveTextContent('No issues are trending');
  });

  it('distinguishes a 404 thread and an empty reply list', async () => {
    const missing = mockClient({ getThread: vi.fn(async () => null) });
    const first = render(<App client={missing} initialPath="/posts/missing" />);
    expect(await screen.findByRole('heading', { name: 'Thread not found' })).toBeInTheDocument();
    first.unmount();

    const empty = mockClient({ getThread: vi.fn(async () => ({ root: livePost, replies: [] })) });
    render(<App client={empty} initialPath="/posts/live-1" />);
    expect(await screen.findByRole('status', { name: /thread has no replies/i })).toHaveTextContent('No replies yet');
  });

  it('shows thread errors with retry without replacing them with fixtures', async () => {
    const getThread = vi.fn()
      .mockRejectedValueOnce(new LiveClientError('rate_limit'))
      .mockResolvedValueOnce({ root: livePost, replies: [] });
    render(<App client={mockClient({ getThread })} initialPath="/posts/live-1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Commons is busy. Please retry shortly.');
    await userEvent.click(screen.getByRole('button', { name: 'Retry thread' }));
    expect(await screen.findByRole('heading', { name: 'Loaded live' })).toBeInTheDocument();
  });
});
