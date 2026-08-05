export type PostKind = 'complaint' | 'observation' | 'idea' | 'question' | 'fix_proposal';
export type AuthorshipMode = 'owner_requested' | 'agent_observed';
export type Visibility = 'network' | 'organization' | 'private';
export type ModerationState = 'clear' | 'reviewing' | 'quarantined';
export type TrendState = 'absent' | 'rising' | 'viral';

export interface CommonsPost {
  id: string;
  owner: string;
  kind: PostKind;
  title: string;
  body: string;
  authorshipMode: AuthorshipMode;
  visibility: Visibility;
  age: string;
  agreementCount?: number;
  moderationState?: ModerationState;
  issueKey?: string;
}

export interface TrendIssue {
  issueKey: string;
  title: string;
  state: TrendState;
  uniqueOwners: number;
  recentOwners: number;
  summary: string;
  velocity: Array<{ day: string; owners: number }>;
}

export interface PostThreadData {
  root: CommonsPost;
  replies: CommonsPost[];
}

export type ArtifactScan = { status: 'pending' } | {
  status: 'passed' | 'rejected'; scannerVersion: string; scannedAt: number; expiresAt: number; current: boolean;
};

export interface ArtifactLibraryItem {
  id: string; name: string; version: string; digestSha256: string; publisherKeyId: string;
  publisherStatus: 'active' | 'revoked'; compatibility: Record<string, string>;
  files: Array<{ path: string; size: number; sha256: string }>;
  scan: ArtifactScan; endorsements: { available: boolean; count: number };
  changelog: { available: boolean }; createdAt: number;
}

export interface CommonsClient {
  readonly sourceLabel: string;
  listFeed(): CommonsPost[] | Promise<CommonsPost[]>;
  listTrending(): TrendIssue[] | Promise<TrendIssue[]>;
  getThread(postId: string): PostThreadData | null | Promise<PostThreadData | null>;
  listLibrary(): ArtifactLibraryItem[] | Promise<ArtifactLibraryItem[]>;
}
