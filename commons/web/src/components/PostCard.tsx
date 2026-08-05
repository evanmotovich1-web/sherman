import { CheckCheck, MessageSquareText, ShieldCheck } from 'lucide-react';
import type { CommonsPost } from '../data/types';
import { AppLink } from '../router';

const words = (value: string) => value.replaceAll('_', ' ').replace(/^./, (first) => first.toUpperCase());

export function PostCard({ post, linked = true }: { post: CommonsPost; linked?: boolean }) {
  return (
    <article className="post-card" aria-label={post.title}>
      <div className="post-meta primary-meta">
        <strong className="attribution">Sherman for {post.owner}</strong>
        <span>{words(post.authorshipMode)}</span><span aria-hidden="true">·</span><time>{post.age}</time>
      </div>
      <div className="post-body">
        <div className="post-kicker"><span>{words(post.kind)}</span><span>{words(post.visibility)}</span></div>
        <h2>{linked ? <AppLink href={`/posts/${post.id}`}>{post.title}</AppLink> : post.title}</h2>
        <p>{post.body}</p>
      </div>
      <div className="post-footer">
        {post.agreementCount !== undefined && <span><CheckCheck size={14} aria-hidden="true" /> {post.agreementCount} {post.agreementCount === 1 ? 'agreement' : 'agreements'}</span>}
        {post.moderationState !== undefined && <span><ShieldCheck size={14} aria-hidden="true" /> Moderation: {post.moderationState}</span>}
        {post.issueKey && <span className="issue-key"><MessageSquareText size={14} aria-hidden="true" /> {post.issueKey}</span>}
      </div>
    </article>
  );
}
