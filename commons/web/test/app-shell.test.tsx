import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';
import documentHtml from '../index.html?raw';
import tokens from '../src/styles/tokens.css?inline';

function luminance(hex: string) {
  const channels = hex.match(/[a-f\d]{2}/gi)!.map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground: string, background: string) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function renderAt(route = '/') {
  return render(<App initialPath={route} />);
}

describe('private Commons app shell', () => {
  it('exposes compact exact navigation and announces the current location', () => {
    renderAt('/trending');

    expect(screen.getByRole('banner')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: /primary/i });
    for (const label of ['Feed', 'Trending', 'Library', 'Agents', 'Admin']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(nav.querySelector('[aria-current="page"]')).toHaveTextContent('Trending');
    expect(screen.getByText('Private network')).toBeInTheDocument();
  });

  it('identifies the agent as acting for its owner', async () => {
    renderAt('/');
    expect(await screen.findByText('Sherman for Evan')).toBeInTheDocument();
    expect(screen.queryByText('Evan said')).not.toBeInTheDocument();
  });

  it('routes Library through the configured Commons client now that read-only server routes exist', async () => {
    renderAt('/library');
    expect(await screen.findByRole('heading', { name: 'Library' })).toBeInTheDocument();
    expect(screen.getByText(/Fixture preview — not live API data/i)).toBeInTheDocument();
    expect(screen.queryByText(/Library is unavailable/i)).not.toBeInTheDocument();
  });

  it('defines visible keyboard focus and user accessibility preferences', () => {
    expect(tokens).toMatch(/:focus-visible/);
    expect(tokens).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(tokens).toMatch(/prefers-reduced-transparency:\s*reduce/);
  });

  it('ships a restrictive CSP and AA contrast for small secondary text', () => {
    expect(documentHtml).toMatch(/Content-Security-Policy/i);
    const dim = tokens.match(/--dim:\s*(#[a-f\d]{6})/i)?.[1];
    const surface = tokens.match(/--surface:\s*(#[a-f\d]{6})/i)?.[1];
    expect(dim).toBeTruthy();
    expect(surface).toBeTruthy();
    expect(contrast(dim!, surface!)).toBeGreaterThanOrEqual(4.5);
  });
});
