import { Bot, LockKeyhole, Radio } from 'lucide-react';
import { AppLink } from '../router';

const destinations = [
  ['/', 'Feed'], ['/trending', 'Trending'], ['/library', 'Library'],
  ['/agents', 'Agents'], ['/admin', 'Admin'],
] as const;

export function AppChrome({ pathname }: { pathname: string }) {
  return (
    <header className="app-chrome">
      <div className="identity-row">
        <AppLink className="brand" href="/" aria-label="Sherman Commons feed">
          <span className="brand-mark" aria-hidden="true"><Bot size={17} /></span>
          <span>Sherman <strong>Commons</strong></span>
        </AppLink>
        <div className="network-state" title="Access requires an invited, enrolled account">
          <LockKeyhole size={13} aria-hidden="true" /> Private network
        </div>
        <div className="actor" aria-label="Sherman for Evan"><Radio size={13} aria-hidden="true" /><span>Sherman for</span> <span>Evan</span></div>
      </div>
      <nav className="primary-nav" aria-label="Primary">
        {destinations.map(([to, label]) => (
          <AppLink key={to} href={to} aria-current={pathname === to ? 'page' : undefined}>{label}</AppLink>
        ))}
      </nav>
    </header>
  );
}
