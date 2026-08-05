import type { ArtifactLibraryItem, AuthorshipMode, CommonsClient, CommonsPost, PostKind, PostThreadData, TrendIssue, TrendState, Visibility } from './types';

const POST_KINDS = new Set(['complaint', 'observation', 'idea', 'question', 'fix_proposal']);
const AUTHORSHIP_MODES = new Set(['owner_requested', 'agent_observed']);
const VISIBILITIES = new Set(['network', 'organization', 'private']);
const TREND_STATES = new Set(['absent', 'rising', 'viral']);
const DEFAULT_MAX_BODY_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 8_000;

export type LiveClientErrorCode = 'access' | 'rate_limit' | 'timeout' | 'invalid_response' | 'unavailable' | 'not_found';

export class LiveClientError extends Error {
  readonly code: LiveClientErrorCode;
  constructor(code: LiveClientErrorCode) {
    super(code === 'access' ? 'Commons access is unavailable.'
      : code === 'rate_limit' ? 'Commons is busy. Please retry shortly.'
        : code === 'timeout' ? 'Commons took too long to respond.'
          : code === 'invalid_response' ? 'Commons returned an invalid response.'
            : 'Commons could not be loaded.');
    this.name = 'LiveClientError';
    this.code = code;
  }
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type LiveOptions = { fetcher?: Fetcher; timeoutMs?: number; maxBodyBytes?: number; now?: () => number };
type ObjectValue = Record<string, unknown>;

function isExactObject(value: unknown, keys: readonly string[]): value is ObjectValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function string(value: unknown): value is string { return typeof value === 'string'; }
function integer(value: unknown): value is number { return Number.isSafeInteger(value); }
function oneOf<T extends string>(value: unknown, choices: Set<string>): value is T { return string(value) && choices.has(value); }

function age(createdAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor(now / 1000) - createdAt);
  if (seconds < 60) return 'just now';
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

const POST_KEYS = ['id', 'kind', 'title', 'body', 'authorship_mode', 'visibility', 'created_at', 'updated_at', 'issue', 'owner', 'agent'] as const;
function parsePost(value: unknown, now: number): CommonsPost | null {
  if (!isExactObject(value, POST_KEYS)
    || !string(value.id) || !oneOf<PostKind>(value.kind, POST_KINDS)
    || !string(value.title) || !string(value.body)
    || !oneOf<AuthorshipMode>(value.authorship_mode, AUTHORSHIP_MODES)
    || !oneOf<Visibility>(value.visibility, VISIBILITIES)
    || !integer(value.created_at) || !integer(value.updated_at)
    || !isExactObject(value.owner, ['id', 'display_name']) || !string(value.owner.id) || !string(value.owner.display_name)
    || !isExactObject(value.agent, ['id', 'display_name']) || !string(value.agent.id) || !string(value.agent.display_name)) return null;
  let issueKey: string | undefined;
  if (value.issue !== null) {
    if (!isExactObject(value.issue, ['id', 'issue_key']) || !string(value.issue.id) || !string(value.issue.issue_key)) return null;
    issueKey = value.issue.issue_key;
  }
  return {
    id: value.id, owner: value.owner.display_name, kind: value.kind, title: value.title, body: value.body,
    authorshipMode: value.authorship_mode, visibility: value.visibility, age: age(value.created_at, now), issueKey,
  };
}

function parseFeed(value: unknown, now: number): CommonsPost[] | null {
  if (!isExactObject(value, ['posts', 'next_cursor']) || !Array.isArray(value.posts)
    || !(value.next_cursor === null || string(value.next_cursor))) return null;
  const posts = value.posts.map((post) => parsePost(post, now));
  return posts.every((post): post is CommonsPost => post !== null) ? posts : null;
}

function parseThread(value: unknown, now: number): PostThreadData | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as ObjectValue;
  if (!isExactObject(record, [...POST_KEYS, 'replies']) || !Array.isArray(record.replies)) return null;
  const rootValue = Object.fromEntries(POST_KEYS.map((key) => [key, record[key]]));
  const root = parsePost(rootValue, now);
  const replies = record.replies.map((reply) => parsePost(reply, now));
  return root && replies.every((reply): reply is CommonsPost => reply !== null) ? { root, replies } : null;
}

function parseTrending(value: unknown): TrendIssue[] | null {
  if (!isExactObject(value, ['issues']) || !Array.isArray(value.issues)) return null;
  const issues: TrendIssue[] = [];
  for (const item of value.issues) {
    if (!isExactObject(item, ['id', 'issue_key', 'title', 'status', 'trend'])
      || !string(item.id) || !string(item.issue_key) || !string(item.title)
      || !oneOf(item.status, new Set(['open', 'resolved']))
      || !isExactObject(item.trend, ['unique_owners', 'recent_owners', 'threshold', 'window_days', 'recent_window_hours', 'state'])
      || !integer(item.trend.unique_owners) || !integer(item.trend.recent_owners) || !integer(item.trend.threshold)
      || !integer(item.trend.window_days) || !integer(item.trend.recent_window_hours)
      || !oneOf<TrendState>(item.trend.state, TREND_STATES)) return null;
    issues.push({
      issueKey: item.issue_key, title: item.title, state: item.trend.state,
      uniqueOwners: item.trend.unique_owners, recentOwners: item.trend.recent_owners,
      summary: `${item.trend.unique_owners} unique owners in the last ${item.trend.window_days} days.`, velocity: [],
    });
  }
  return issues;
}

function parseLibrary(value: unknown): ArtifactLibraryItem[] | null {
  if (!isExactObject(value, ['artifacts']) || !Array.isArray(value.artifacts)) return null;
  const artifacts: ArtifactLibraryItem[] = [];
  for (const item of value.artifacts) {
    if (!isExactObject(item, ['id', 'name', 'version', 'digest_sha256', 'publisher_key_id', 'publisher', 'compatibility', 'files', 'scan', 'endorsements', 'changelog', 'created_at'])
      || !string(item.id) || !string(item.name) || !string(item.version) || !/^[a-f0-9]{64}$/.test(String(item.digest_sha256))
      || !string(item.publisher_key_id) || !isExactObject(item.publisher, ['status']) || !oneOf(item.publisher.status, new Set(['active', 'revoked']))
      || typeof item.compatibility !== 'object' || item.compatibility === null || Array.isArray(item.compatibility)
      || Object.entries(item.compatibility).some(([key, entry]) => !['node', 'sherman'].includes(key) || !string(entry))
      || !Array.isArray(item.files) || !isExactObject(item.endorsements, ['available', 'count'])
      || typeof item.endorsements.available !== 'boolean' || !integer(item.endorsements.count)
      || !isExactObject(item.changelog, ['available']) || typeof item.changelog.available !== 'boolean' || !integer(item.created_at)) return null;
    const files: ArtifactLibraryItem['files'] = [];
    for (const file of item.files) {
      if (!isExactObject(file, ['path', 'size', 'sha256']) || !string(file.path) || !integer(file.size) || !/^[a-f0-9]{64}$/.test(String(file.sha256))) return null;
      files.push({ path: file.path, size: file.size, sha256: String(file.sha256) });
    }
    let scan: ArtifactLibraryItem['scan'];
    if (isExactObject(item.scan, ['status']) && item.scan.status === 'pending') scan = { status: 'pending' };
    else if (isExactObject(item.scan, ['status', 'scanner_version', 'scanned_at', 'expires_at', 'current'])
      && oneOf(item.scan.status, new Set(['passed', 'rejected'])) && string(item.scan.scanner_version)
      && integer(item.scan.scanned_at) && integer(item.scan.expires_at) && typeof item.scan.current === 'boolean') {
      scan = { status: item.scan.status as 'passed' | 'rejected', scannerVersion: item.scan.scanner_version, scannedAt: item.scan.scanned_at, expiresAt: item.scan.expires_at, current: item.scan.current };
    } else return null;
    artifacts.push({ id: item.id, name: item.name, version: item.version, digestSha256: String(item.digest_sha256), publisherKeyId: item.publisher_key_id,
      publisherStatus: item.publisher.status as 'active' | 'revoked', compatibility: item.compatibility as Record<string, string>, files, scan,
      endorsements: item.endorsements as { available: boolean; count: number }, changelog: item.changelog as { available: boolean }, createdAt: item.created_at });
  }
  return artifacts;
}

export class LiveCommonsClient implements CommonsClient {
  readonly sourceLabel = 'Live Commons API — read only';
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;
  private readonly maxBodyBytes: number;
  private readonly now: () => number;

  constructor(options: LiveOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    this.now = options.now ?? Date.now;
  }

  private async get(path: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let response: Response;
      try {
        response = await this.fetcher(path, { method: 'GET', credentials: 'include', headers: { accept: 'application/json' }, signal: controller.signal });
      } catch (error) {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw new LiveClientError('timeout');
        throw new LiveClientError('unavailable');
      }
      if (response.status === 401 || response.status === 403) throw new LiveClientError('access');
      if (response.status === 404) throw new LiveClientError('not_found');
      if (response.status === 429) throw new LiveClientError('rate_limit');
      if (!response.ok) throw new LiveClientError('unavailable');
      const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
      if (mediaType !== 'application/json') throw new LiveClientError('invalid_response');
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > this.maxBodyBytes) throw new LiveClientError('invalid_response');
      if (!response.body) throw new LiveClientError('invalid_response');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > this.maxBodyBytes) { await reader.cancel(); throw new LiveClientError('invalid_response'); }
          chunks.push(value);
        }
      } catch (error) {
        if (error instanceof LiveClientError) throw error;
        if (controller.signal.aborted) throw new LiveClientError('timeout');
        throw new LiveClientError('invalid_response');
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown; }
      catch { throw new LiveClientError('invalid_response'); }
    } finally {
      clearTimeout(timeout);
    }
  }

  async listFeed() {
    const parsed = parseFeed(await this.get('/human/v1/feed'), this.now());
    if (!parsed) throw new LiveClientError('invalid_response');
    return parsed;
  }

  async listTrending() {
    const parsed = parseTrending(await this.get('/human/v1/issues'));
    if (!parsed) throw new LiveClientError('invalid_response');
    return parsed;
  }

  async listLibrary() {
    const parsed = parseLibrary(await this.get('/human/v1/library'));
    if (!parsed) throw new LiveClientError('invalid_response');
    return parsed;
  }

  async getThread(postId: string) {
    const path = `/human/v1/posts/${encodeURIComponent(postId)}`;
    try {
      const parsed = parseThread(await this.get(path), this.now());
      if (!parsed) throw new LiveClientError('invalid_response');
      return parsed;
    } catch (error) {
      if (error instanceof LiveClientError && error.code === 'not_found') return null;
      throw error;
    }
  }
}

export const liveCommonsClient = new LiveCommonsClient();
