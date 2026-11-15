// Router. The landing page, the app and the poster load as separate chunks, so the landing page
// never downloads the wallet-connection code.
import { Suspense, lazy, useEffect, useState } from 'react';
import { route } from './route';

const Landing = lazy(() => import('./landing/Landing').then((m) => ({ default: m.Landing })));
const AppRoot = lazy(() => import('./app/AppRoot').then((m) => ({ default: m.AppRoot })));
const SignInDemo = lazy(() => import('./identity/SignInDemo').then((m) => ({ default: m.SignInDemo })));
const Poster = lazy(() => import('./app/Poster').then((m) => ({ default: m.Poster })));

const currentPath = () => window.location.hash.replace(/^#/, '') || '/';

export function App() {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const onHash = () => { setPath(currentPath()); window.scrollTo({ top: 0 }); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const r = route(path);
  return (
    <Suspense fallback={<div className={r.kind === 'app' ? 'boot app' : 'boot land'} />}>
      {r.kind === 'landing' && <Landing />}
      {r.kind === 'poster' && <Poster shop={r.shop} />}
      {r.kind === 'signin' && <SignInDemo />}
      {r.kind === 'app' && <AppRoot page={r.page} shop={r.shop} query={r.query} path={path} />}
    </Suspense>
  );
}
