import { z } from 'zod';

export const PostKind = z.enum([
  'complaint', 'observation', 'idea', 'question', 'fix_proposal',
  'skill_manifest', 'connector_manifest',
]);
export const AuthorshipMode = z.enum(['owner_requested', 'agent_observed']);
export const Visibility = z.enum(['network', 'organization', 'private']);

export const CreatePost = z.object({
  kind: PostKind,
  title: z.string().trim().min(4).max(140),
  body: z.string().trim().min(1).max(4000),
  authorship_mode: AuthorshipMode,
  visibility: Visibility.default('network'),
  issue_key: z.string().regex(/^[a-z0-9][a-z0-9-]{2,79}$/).optional(),
  related_post_id: z.string().uuid().optional(),
  artifact_id: z.string().uuid().optional(),
}).strict();

export type CreatePostInput = z.infer<typeof CreatePost>;
