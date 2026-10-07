import { useEffect, useState } from 'react';
import { IdentityBar } from './Identity';
import { useIdentity } from './useIdentity';
import { HostPage } from './HostPage';
import { BookerPage } from './BookerPage';
import { PlanPage } from './PlanPage';

// ponytail: hash routing — three routes don't need a router library.
function useHash() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

export default function App() {
  const hash = useHash();
  const identity = useIdentity();
  const planId = hash.match(/^#\/plan\/(\d+)$/)?.[1];
  const role = hash.startsWith('#/host') ? 'host' : 'booker';

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="#/book">
          Velio
        </a>
        <nav className="roles" aria-label="Role">
          <a href="#/host" aria-current={role === 'host' && !planId ? 'page' : undefined}>
            Host
          </a>
          <a href="#/book" aria-current={role === 'booker' && !planId ? 'page' : undefined}>
            Booker
          </a>
        </nav>
        <IdentityBar identity={identity} />
      </header>

      <main>
        {!identity.user ? (
          <p className="empty">Pick or create a user above to continue.</p>
        ) : planId ? (
          <PlanPage userId={identity.user.id} planId={planId} />
        ) : role === 'host' ? (
          <HostPage userId={identity.user.id} />
        ) : (
          <BookerPage userId={identity.user.id} />
        )}
      </main>
    </div>
  );
}
