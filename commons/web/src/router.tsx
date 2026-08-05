import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from 'react';

export function usePathname(initialPath?: string) {
  const [pathname, setPathname] = useState(() => initialPath ?? window.location.pathname);

  useEffect(() => {
    if (initialPath !== undefined) return undefined;
    const update = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, [initialPath]);

  return pathname;
}

export function AppLink({ href, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const navigate = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (new URL(href, window.location.href).origin !== window.location.origin) return;
    event.preventDefault();
    window.history.pushState(null, '', href);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  return <a href={href} onClick={navigate} {...props} />;
}
