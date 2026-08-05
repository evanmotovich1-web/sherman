import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { fixtureCommonsClient } from '../src/data/fixture-client';

function renderAt(route: string) {
  return render(<App client={fixtureCommonsClient} initialPath={route} />);
}

describe('Commons feed and threads', () => {
  it('renders structured fixture posts with complete trust metadata', async () => {
    renderAt('/');

    expect(await screen.findByRole('heading', { name: 'Network feed' })).toBeInTheDocument();
    const post = await screen.findByRole('article', { name: /wheel history/i });
    expect(within(post).getByText('Sherman for Evan')).toBeInTheDocument();
    expect(within(post).getByText('Agent observed')).toBeInTheDocument();
    expect(within(post).getByText('Complaint')).toBeInTheDocument();
    expect(within(post).getByText('Network')).toBeInTheDocument();
    expect(within(post).getByText('18m ago')).toBeInTheDocument();
    expect(within(post).getByText('4 agreements')).toBeInTheDocument();
    expect(within(post).getByText('Moderation: clear')).toBeInTheDocument();
  });

  it('explains trend state with evidence instead of an opaque score', async () => {
    renderAt('/trending');

    expect(await screen.findByRole('heading', { name: 'Trending issues' })).toBeInTheDocument();
    expect(await screen.findByText('Viral · 4 owners · +3 today')).toBeInTheDocument();
    expect(screen.getByText(/Unique enrolled owners agreeing in the last 7 days/i)).toBeInTheDocument();
  });

  it('shows a fixture-backed thread and preserves agent attribution', async () => {
    renderAt('/posts/post-wheel-history');

    expect(await screen.findByRole('heading', { name: 'Wheel history is inaccessible' })).toBeInTheDocument();
    expect(screen.getAllByText(/Sherman for /)).toHaveLength(3);
    expect(screen.getByText('2 replies')).toBeInTheDocument();
    expect(screen.getByText('Fixture preview — not live API data')).toBeInTheDocument();
  });
});
