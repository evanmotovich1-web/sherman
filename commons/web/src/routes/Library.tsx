import { EmptyState, ErrorState, LoadingState, useResource } from '../components/ResourceState';
import type { ArtifactLibraryItem, CommonsClient } from '../data/types';

function compatibilityLabel(compatibility: Record<string, string>) {
  const entries = Object.entries(compatibility);
  return entries.length ? entries.map(([runtime, range]) => `${runtime} ${range.replace('>=', '≥').replace('<=', '≤')}`).join(' · ') : 'Compatibility unavailable';
}

function scanLabel(item: ArtifactLibraryItem) {
  if (item.scan.status === 'pending') return 'Pending scan';
  if (item.scan.status === 'rejected') return 'Rejected scan';
  return 'Passed scan';
}

function ArtifactCard({ item }: { item: ArtifactLibraryItem }) {
  const downloadable = item.scan.status === 'passed' && item.scan.current && item.publisherStatus === 'active';
  return <article className="post-card library-card">
    <header className="post-card__header">
      <div><p className="eyebrow">Artifact · {item.version}</p><h2>{item.name}</h2></div>
      <span className={`state-badge state-badge--${item.scan.status}`}>{scanLabel(item)}</span>
    </header>
    <dl className="metadata-grid">
      <div><dt>Publisher key</dt><dd>{item.publisherKeyId} · {item.publisherStatus}</dd></div>
      <div><dt>Digest</dt><dd><code>{item.digestSha256}</code></dd></div>
      <div><dt>Compatibility</dt><dd>{compatibilityLabel(item.compatibility)}</dd></div>
      <div><dt>Verification</dt><dd>{item.scan.status === 'pending' ? 'No scanner result recorded'
        : `${item.scan.scannerVersion} · ${item.scan.current ? `current until ${new Date(item.scan.expiresAt * 1000).toISOString()}` : 'expired result'}`}</dd></div>
    </dl>
    <details><summary>{item.files.length} manifest file{item.files.length === 1 ? '' : 's'}</summary>
      <ul>{item.files.map((file) => <li key={file.path}><code>{file.path}</code> · {file.size} bytes · <code>{file.sha256}</code></li>)}</ul>
    </details>
    <p className="post-card__meta">{item.endorsements.available ? `${item.endorsements.count} endorsements` : 'Endorsements unavailable'} · {item.changelog.available ? 'Changelog available' : 'Changelog unavailable'}</p>
    {downloadable ? <a className="text-link" href={`/human/v1/artifacts/${encodeURIComponent(item.id)}/download`}>Download verified bytes</a> : null}
  </article>;
}

export function Library({ client }: { client: CommonsClient }) {
  const { state, retry } = useResource(() => client.listLibrary(), [client]);
  return <section className="route-shell">
    <header className="route-heading"><div><p className="eyebrow">Published artifacts</p><h1>Library</h1></div><p>{client.sourceLabel}</p></header>
    {state.status === 'loading' ? <LoadingState label="artifact metadata" /> : null}
    {state.status === 'error' ? <ErrorState label="artifact metadata" message={state.message} retry={retry} /> : null}
    {state.status === 'success' && state.data.length === 0 ? <EmptyState label="Library">No visible artifact versions have been published.</EmptyState> : null}
    {state.status === 'success' && state.data.length > 0 ? <div className="feed-list">{state.data.map((item) => <ArtifactCard key={item.id} item={item} />)}</div> : null}
  </section>;
}
