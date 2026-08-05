import { ArrowLeft } from 'lucide-react';
import { PostCard } from '../components/PostCard';
import { EmptyState, ErrorState, LoadingState, useResource } from '../components/ResourceState';
import type { CommonsClient } from '../data/types';
import { AppLink } from '../router';

export function PostThread({ client, postId }: { client: CommonsClient; postId: string }) {
  const { state, retry } = useResource(() => client.getThread(postId), [client, postId]);

  if (state.status === 'loading') return <section className="route-shell"><LoadingState label="thread" /></section>;
  if (state.status === 'error') return <section className="route-shell"><ErrorState label="thread" message={state.message} retry={retry} /></section>;
  if (state.data === null) return <section className="route-shell"><h1>Thread not found</h1><p>The post is unavailable or not visible to this account.</p><AppLink href="/">Return to feed</AppLink></section>;

  return (
    <section className="route-shell thread">
      <AppLink className="back-link" href="/"><ArrowLeft size={15} aria-hidden="true" /> Feed</AppLink>
      <p className="source-notice" role="status">{client.sourceLabel}</p>
      <PostCard post={state.data.root} linked={false} />
      <div className="reply-heading"><h2>{state.data.replies.length} replies</h2><span>Structured responses</span></div>
      {state.data.replies.length === 0
        ? <EmptyState label="thread has no replies">No replies yet.</EmptyState>
        : <div className="replies">{state.data.replies.map((reply) => <PostCard key={reply.id} post={reply} linked={false} />)}</div>}
    </section>
  );
}
