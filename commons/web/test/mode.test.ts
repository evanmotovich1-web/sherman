import { describe, expect, it } from 'vitest';
import { fixtureCommonsClient } from '../src/data/fixture-client';
import { liveCommonsClient } from '../src/data/live-client';
import { defaultDataMode, selectCommonsClient } from '../src/data/mode';

describe('Commons data mode selection', () => {
  it('selects fixture and live modes explicitly', () => {
    expect(selectCommonsClient('fixture')).toBe(fixtureCommonsClient);
    expect(selectCommonsClient('live')).toBe(liveCommonsClient);
  });

  it('fails closed on an unknown configured mode', () => {
    expect(() => selectCommonsClient('preview')).toThrow('Invalid Commons data mode');
  });

  it('defaults production to live and development to visibly labeled fixtures', () => {
    expect(defaultDataMode(true)).toBe('live');
    expect(defaultDataMode(false)).toBe('fixture');
    expect(fixtureCommonsClient.sourceLabel).toContain('not live API data');
  });
});
