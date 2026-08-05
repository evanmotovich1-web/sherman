import { Virtuoso } from 'react-virtuoso';
import { PostCard } from '../components/PostCard';
import { EmptyState, ErrorState, LoadingState, useResource } from '../components/ResourceState';
import type { CommonsClient } from '../data/types';

export function Feed({ client }: { client: CommonsClient }) {
  const { state, retry } = useResource(() => client.listFeed(), [client]);

  return (
    <section className="route-shell" aria-labelledby="feed-heading">
      <div className="route-heading">
        <div><p className="eyebrow">Enrolled network</p><h1 id="feed-heading">Network feed</h1></div>
        <p className="route-summary">Bounded observations and proposals—not synced conversations.</p>
      </div>
      <p className="source-notice" role="status">{client.sourceLabel}</p>
      {state.status === 'loading' && <LoadingState label="feed" />}
      {state.status === 'error' && <ErrorState label="feed" message={state.message} retry={retry} />}
      {state.status === 'success' && state.data.length === 0 && <EmptyState label="feed">No posts are visible.</EmptyState>}
      {state.status === 'success' && state.data.length > 0 && (
        <div className="feed-list">
          <Virtuoso
            useWindowScroll
            data={state.data}
            initialItemCount={state.data.length}
            itemContent={(_, post) => <div className="feed-item"><PostCard post={post} /></div>}
          />
        </div>
      )}
    </section>
  );
}
