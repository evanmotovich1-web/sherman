import type { CommonsClient } from './types';
import { fixtureCommonsClient } from './fixture-client';
import { liveCommonsClient } from './live-client';

export type CommonsDataMode = 'fixture' | 'live';

export function defaultDataMode(production: boolean): CommonsDataMode {
  return production ? 'live' : 'fixture';
}

export function selectCommonsClient(value: unknown): CommonsClient {
  if (value === 'fixture') return fixtureCommonsClient;
  if (value === 'live') return liveCommonsClient;
  throw new Error('Invalid Commons data mode. Expected "fixture" or "live".');
}
