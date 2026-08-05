import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { EmptyState, ErrorState, LoadingState, useResource } from '../components/ResourceState';
import { TrendBadge } from '../components/TrendBadge';
import type { CommonsClient, TrendIssue } from '../data/types';

function TrendCard({ trend }: { trend: TrendIssue }) {
  const copyKey = async () => {
    await navigator.clipboard?.writeText(trend.issueKey);
    toast.success('Issue key copied');
  };
  return (
    <article className="trend-card" aria-label={trend.title}>
      <div className="trend-copy">
        <TrendBadge trend={trend} />
        <h2>{trend.title}</h2><p>{trend.summary}</p>
        <button className="text-button" type="button" onClick={() => void copyKey()}>Copy issue key · {trend.issueKey}</button>
      </div>
      {trend.velocity.length > 0 && (
        <div className="trend-chart" role="img" aria-label={`Agreement velocity for ${trend.title}`}>
          <ResponsiveContainer width="100%" height={150}>
            <LineChart data={trend.velocity} margin={{ top: 10, right: 10, bottom: 0, left: -26 }}>
              <XAxis dataKey="day" tickLine={false} axisLine={false} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ background: '#171025', border: '1px solid #3a2c54', borderRadius: 10 }} />
              <Line type="monotone" dataKey="owners" stroke="#ff4fa7" strokeWidth={3} dot={{ fill: '#78a8ff', r: 3 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </article>
  );
}

export function Trending({ client }: { client: CommonsClient }) {
  const { state, retry } = useResource(() => client.listTrending(), [client]);
  return (
    <section className="route-shell" aria-labelledby="trending-heading">
      <div className="route-heading"><div><p className="eyebrow">Transparent consensus</p><h1 id="trending-heading">Trending issues</h1></div><p className="route-summary">Ranked by unique-owner evidence, never an unexplained score.</p></div>
      <p className="source-notice" role="status">{client.sourceLabel}</p>
      <p className="evidence-note">Unique enrolled owners agreeing in the last 7 days; “today” is the last 24 hours.</p>
      {state.status === 'loading' && <LoadingState label="trending" />}
      {state.status === 'error' && <ErrorState label="trending" message={state.message} retry={retry} />}
      {state.status === 'success' && state.data.length === 0 && <EmptyState label="trending">No issues are trending.</EmptyState>}
      {state.status === 'success' && state.data.length > 0 && <div className="trend-list">{state.data.map((trend) => <TrendCard key={trend.issueKey} trend={trend} />)}</div>}
    </section>
  );
}
