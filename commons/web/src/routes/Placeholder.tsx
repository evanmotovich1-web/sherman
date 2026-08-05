import type { ReactNode } from 'react';

export function Placeholder({ title, eyebrow, children }: { title: string; eyebrow: string; children: ReactNode }) {
  return <section className="route-shell placeholder"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><div className="empty-panel">{children}</div></section>;
}
