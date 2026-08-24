import { useState, type ReactNode } from 'react';
import {
  AppScrollView,
  AppShell,
  AppViewport,
  HomeframeErrorBoundary,
  HomeframeInput,
  HomeframeProvider,
  SelectableText,
} from '@builtbyted/react';
import {
  HomeframeRouterProvider,
  NavLink,
  RouterOutlet,
  createHomeframeRouter,
  useRouteScrollRestoration,
} from '@builtbyted/router';

const appBase = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;
const appPath = (path = '/') => path === '/'
  ? appBase
  : `${appBase}${path.replace(/^\/+/, '')}`;

const router = createHomeframeRouter([
  { id: 'home', path: appPath(), element: <HomePage /> },
  { id: 'about', path: appPath('/about'), element: <AboutPage /> },
  { id: 'not-found', path: '*', element: <NotFoundPage /> },
]);

export function App() {
  return (
    <HomeframeProvider>
      <HomeframeRouterProvider router={router}>
        <HomeframeErrorBoundary fallback={(error, retry) => (
          <AppViewport className="fatal-screen">
            <main className="page">
              <h1>Something went wrong</h1>
              <SelectableText>{error.message}</SelectableText>
              <button type="button" onClick={retry}>Try again</button>
            </main>
          </AppViewport>
        )}>
          <ApplicationShell />
        </HomeframeErrorBoundary>
      </HomeframeRouterProvider>
    </HomeframeProvider>
  );
}

function ApplicationShell() {
  const { scrollKey, direction, scrollBehavior, permalinkScroll } = useRouteScrollRestoration();
  return (
    <AppViewport className="app-viewport">
      <AppShell header={<Header />} bottom={<BottomNavigation />}>
        <AppScrollView
          className="page-scroll"
          scrollKey={scrollKey}
          navigationType={direction}
          scrollBehavior={scrollBehavior}
          permalinkScroll={permalinkScroll}
        >
          <RouterOutlet />
        </AppScrollView>
      </AppShell>
    </AppViewport>
  );
}

function Header() {
  return (
    <header className="top-bar">
      <span className="brand-mark" aria-hidden="true">__HOMEFRAME_APP_INITIAL__</span>
      <strong>__HOMEFRAME_APP_NAME_HTML__</strong>
    </header>
  );
}

function BottomNavigation() {
  return (
    <nav className="bottom-nav" aria-label="Primary navigation">
      <NavLink to={appPath()}>Home</NavLink>
      <NavLink to={appPath('/about')}>About</NavLink>
    </nav>
  );
}

function Page({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <main className="page">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      {children}
    </main>
  );
}

function HomePage() {
  const [draft, setDraft] = useState('');
  return (
    <Page eyebrow="Homeframe starter" title="Build the product. Keep the native edges stable.">
      <p className="lede">
        This shell already owns safe areas, keyboard geometry, routing, startup presentation,
        installation metadata, and service-worker updates.
      </p>
      <section className="card">
        <label htmlFor="starter-note">Try the keyboard-safe input</label>
        <HomeframeInput
          id="starter-note"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Write a note"
        />
        <p>{draft ? `Draft: ${draft}` : 'Your app state belongs here.'}</p>
      </section>
    </Page>
  );
}

function AboutPage() {
  return (
    <Page eyebrow="Architecture" title="Framework boundaries are part of the product.">
      <div className="card prose">
        <p>Read <SelectableText>AGENTS.md</SelectableText> before asking an AI coder to change the app.</p>
        <p>The detailed workflow and release checklist live in <SelectableText>docs/HOMEFRAME_RUNBOOK.md</SelectableText>.</p>
      </div>
    </Page>
  );
}

function NotFoundPage() {
  return (
    <Page eyebrow="404" title="That page does not exist.">
      <NavLink className="button-link" to={appPath()}>Return home</NavLink>
    </Page>
  );
}
