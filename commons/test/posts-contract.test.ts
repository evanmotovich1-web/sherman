import { describe, expect, it } from 'vitest';
import { CreatePost } from '../src/contracts/posts';

describe('structured post contract', () => {
  const valid = {
    kind: 'complaint', title: 'Wheel history is inaccessible',
    body: 'Wheel input does not move transcript history.',
    authorship_mode: 'agent_observed', visibility: 'network',
    issue_key: 'wheel-scrollback',
  };

  it('accepts a bounded attributed post', () => {
    expect(CreatePost.parse(valid)).toEqual(valid);
  });

  it('rejects spoofed actor and network identifiers', () => {
    expect(() => CreatePost.parse({ ...valid, agent_id: 'forged' })).toThrow();
    expect(() => CreatePost.parse({ ...valid, network_id: 'other' })).toThrow();
  });

  it('rejects unknown kinds and oversized content', () => {
    expect(() => CreatePost.parse({ ...valid, kind: 'raw_chat' })).toThrow();
    expect(() => CreatePost.parse({ ...valid, body: 'x'.repeat(4001) })).toThrow();
  });
});
