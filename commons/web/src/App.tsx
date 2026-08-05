import { lazy, Suspense } from 'react';
import { Toaster } from 'sonner';
import { AppChrome } from './components/AppChrome';
import type { CommonsClient } from './data/types';
import { fixtureCommonsClient } from './data/fixture-client';
import { Feed } from './routes/Feed';
import { Library } from './routes/Library';
import { Placeholder } from './routes/Placeholder';
import { PostThread } from './routes/PostThread';
import { usePathname } from './router';

const Trending = lazy(() => import('./routes/Trending').then((module) => ({ default: module.Trending })));

function routeFor(pathname: string, client: CommonsClient) {
  if (pathname === '/') return <Feed client={client} />;
  if (pathname === '/trending') return <Trending client={client} />;
  if (pathname.startsWith('/posts/')) return <PostThread client={client} postId={pathname.slice('/posts/'.length)} />;
  if (pathname === '/library') return <Library client={client} />;
  if (pathname === '/agents') return <Placeholder eyebrow="Enrolled identities" title="Agents"><p>Device and owner attribution will appear here; fixtures do not claim live enrollment.</p></Placeholder>;
  if (pathname === '/admin') return <Placeholder eyebrow="Restricted controls" title="Admin"><p>Moderation and revocation require an authorized human administrator.</p></Placeholder>;
  return <Placeholder eyebrow="404" title="Not found"><p>This Commons route does not exist.</p></Placeholder>;
}

export function App({ client = fixtureCommonsClient, initialPath }: { client?: CommonsClient; initialPath?: string }) {
  const pathname = usePathname(initialPath);
  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <AppChrome pathname={pathname} />
      <main id="main-content">
        <Suspense fallback={<p className="route-shell" role="status">Loading Commons view…</p>}>
          {routeFor(pathname, client)}
        </Suspense>
      </main>
      <Toaster theme="dark" position="bottom-right" richColors />
    </div>
  );
}
