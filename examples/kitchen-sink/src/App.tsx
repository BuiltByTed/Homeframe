import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getHomeframeRootStyle } from '@homeframe/runtime';
import {
  AppScrollView,
  AppShell,
  AppViewport,
  HomeframeDiagnostics,
  HomeframeErrorBoundary,
  HomeframeInput,
  HomeframeOfflineBoundary,
  HomeframeProvider,
  HomeframeRecovery,
  HomeframeSelect,
  HomeframeTextarea,
  KeyboardDock,
  NoCallout,
  SelectableText,
  useAppBadge,
  useAppLifecycle,
  useDisplayMode,
  useHomeframeUpdate,
  useInstallCapability,
  useKeyboard,
  useNotificationCapability,
  useStateCheckpoint,
  useViewport,
} from '@homeframe/react';
import {
  HomeframeRouterProvider,
  Link,
  NavLink,
  RouterOutlet,
  createHomeframeRouter,
  useNavigationDirection,
  useNavigationGesture,
  useHomeframeRouter,
  usePermalink,
  useRouteScrollRestoration,
  useRouterSnapshot,
  type RouteMatch,
} from '@homeframe/router';

const appBase = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;
const appPath = (path = '/') => path === '/'
  ? appBase
  : `${appBase}${path.replace(/^\/+/, '')}`;
const staticDemo = import.meta.env.VITE_HOMEFRAME_STATIC_DEMO === 'true';
type ThemePreference = 'system' | 'light' | 'dark';
const ThemePreferenceContext = createContext<{
  preference: ThemePreference;
  resolved: 'light' | 'dark';
  setPreference: (preference: ThemePreference) => void;
} | null>(null);

const cards = Array.from({ length: 30 }, (_, index) => ({
  id: index + 1,
  title: `Restoration item ${index + 1}`,
  text: 'Scroll here, change routes, then swipe back to verify the exact scroll position is restored.',
}));
const permalinkItems = Array.from({ length: 24 }, (_, index) => ({
  id: index + 1,
  title: index % 3 === 0 ? `Keyboard finding ${index + 1}` : `Release finding ${index + 1}`,
  text: 'This stable item id can be opened directly after a cold launch or on another device.',
}));

const router = createHomeframeRouter([
  { id: 'home', path: appPath(), element: <OverviewPage /> },
  { id: 'keyboard', path: appPath('/keyboard'), element: <KeyboardPage /> },
  { id: 'history', path: appPath('/history'), element: <HistoryPage /> },
  { id: 'detail', path: appPath('/history/:id'), element: (match) => <DetailPage match={match} /> },
  { id: 'permalink', path: appPath('/permalinks/:view'), element: (match) => <PermalinkPage match={match} /> },
  { id: 'pwa', path: appPath('/pwa'), element: <PwaPage /> },
  { id: 'settings', path: appPath('/settings'), element: <SettingsPage /> },
  { id: 'recovery', path: appPath('/__homeframe/recovery'), element: <HomeframeRecovery title="Homeframe recovery" /> },
  { id: 'not-found', path: '*', element: <NotFoundPage /> },
]);

export function App() {
  return (
    <HomeframeProvider>
      <ThemePreferenceProvider>
        <HomeframeRouterProvider router={router}>
          <HomeframeErrorBoundary fallback={(error, retry) => (
            <AppViewport className="fatal-screen">
              <h1>Something went wrong</h1>
              <SelectableText>{error.message}</SelectableText>
              <button onClick={retry}>Retry</button>
            </AppViewport>
          )}>
            <ApplicationShell />
          </HomeframeErrorBoundary>
        </HomeframeRouterProvider>
      </ThemePreferenceProvider>
    </HomeframeProvider>
  );
}

function ThemePreferenceProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useStateCheckpoint<ThemePreference>({
    key: 'theme-preference',
    storage: 'local',
    initialValue: 'system',
    deserialize: (value) => {
      const parsed = JSON.parse(value) as unknown;
      return parsed === 'light' || parsed === 'dark' ? parsed : 'system';
    },
  });
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const resolved = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const runtimeStyle = getHomeframeRootStyle();
    root.dataset.hfDemoTheme = resolved;
    runtimeStyle.setProperty('--hf-color-scheme', `only ${resolved}`);
    runtimeStyle.setProperty('--hf-app-background', resolved === 'dark' ? '#0b1429' : '#e8f0ff');
    const themes = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
    const light = themes.find((meta) => meta.content.toLowerCase() === '#dbeafe');
    const dark = themes.find((meta) => meta.content.toLowerCase() === '#020617');
    if (light && dark) {
      light.media = preference === 'system' ? '(prefers-color-scheme: light)'
        : preference === 'light' ? 'all' : 'not all';
      dark.media = preference === 'system' ? '(prefers-color-scheme: dark)'
        : preference === 'dark' ? 'all' : 'not all';
    }
  }, [preference, resolved]);

  const value = useMemo(() => ({ preference, resolved, setPreference }), [preference, resolved, setPreference]);
  return <ThemePreferenceContext.Provider value={value}>{children}</ThemePreferenceContext.Provider>;
}

function useThemePreference() {
  const value = useContext(ThemePreferenceContext);
  if (!value) throw new Error('Theme preference requires ThemePreferenceProvider.');
  return value;
}

function ApplicationShell() {
  const route = useRouterSnapshot();
  const { scrollKey, direction, permalinkScroll } = useRouteScrollRestoration();
  return (
    <AppViewport className="app-viewport">
      <AppShell
        header={<Header />}
        bottom={<ShellBottom routeId={route.match?.route.id} />}
      >
        <HomeframeOfflineBoundary offline={<OfflinePage />}>
          <AppScrollView
            key={route.match?.route.id}
            className="page-scroll"
            scrollKey={scrollKey}
            navigationType={direction}
            permalinkScroll={permalinkScroll}
            data-route={route.match?.route.id}
          >
            <RouteStatus />
            <RouterOutlet />
          </AppScrollView>
        </HomeframeOfflineBoundary>
      </AppShell>
      <CapabilityNudges />
      <UpdateNotice />
      <HomeframeDiagnostics />
    </AppViewport>
  );
}

function Header() {
  const keyboard = useKeyboard();
  const display = useDisplayMode();
  return (
    <header className="top-bar">
      <NoCallout as="div" className="brand-mark">H</NoCallout>
      <div className="header-title">
        <strong>Homeframe</strong>
        <span>{display} · keyboard {keyboard.phase}</span>
      </div>
      <Link to={appPath('/settings')} className="icon-button" aria-label="Settings">⚙</Link>
    </header>
  );
}

function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Primary navigation">
      <NavLink to={appPath()}><span>⌂</span>Home</NavLink>
      <NavLink to={appPath('/keyboard')}><span>⌨</span>Keyboard</NavLink>
      <NavLink to={appPath('/history')}><span>⇄</span>History</NavLink>
      <NavLink to={appPath('/pwa')}><span>◉</span>PWA</NavLink>
    </nav>
  );
}

function ShellBottom({ routeId }: { routeId: string | undefined }) {
  const [draft, setDraft] = useStateCheckpoint({ key: 'keyboard-draft', initialValue: '' });
  if (routeId !== 'keyboard') return <BottomNav />;
  return (
    <div className="composer">
      <HomeframeInput aria-label="Persistent composer" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Persistent bottom composer" />
      <button onClick={() => setDraft('')}>Send</button>
    </div>
  );
}

function RouteStatus() {
  const direction = useNavigationDirection();
  const gesture = useNavigationGesture();
  return (
    <output className="route-direction" aria-live="polite">
      Navigation: {direction} · swipe {gesture.phase}
      {gesture.direction ? ` ${gesture.direction} ${Math.round(gesture.progress * 100)}%` : ''}
    </output>
  );
}

function Page({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section className="page">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      {children}
    </section>
  );
}

function OverviewPage() {
  const viewport = useViewport();
  const lifecycle = useAppLifecycle();
  return (
    <Page eyebrow="Reference application" title="Every rough iOS edge, in one test app">
      <p className="lede">Install this app, rotate it, open every keyboard, swipe through history, go offline, and update it without losing the shell.</p>
      <div className="metric-grid">
        <Metric label="Visual viewport" value={`${viewport.width.toFixed(0)} × ${viewport.height.toFixed(0)}`} />
        <Metric label="Safe area" value={`${viewport.safeArea.top}/${viewport.safeArea.right}/${viewport.safeArea.bottom}/${viewport.safeArea.left}`} />
        <Metric label="Lifecycle" value={lifecycle.phase} />
        <Metric label="Build" value={window.__HOMEFRAME_BUILD__?.buildId ?? 'development'} />
      </div>
      <h2>Test labs</h2>
      <div className="feature-list">
        <FeatureLink to={appPath('/keyboard')} icon="⌨" title="Keyboard & safe areas">Focus controls at every scroll depth.</FeatureLink>
        <FeatureLink to={appPath('/history')} icon="⇄" title="History & restoration">Use links and native edge swipes.</FeatureLink>
        <FeatureLink to={appPath('/permalinks/release-board')} icon="⌁" title="Deep links & permalinks">Share a route, view, anchor, or exact scroll position.</FeatureLink>
        <FeatureLink to={appPath('/pwa')} icon="◉" title="Install, update & notify">Exercise all PWA capability states.</FeatureLink>
      </div>
      <div className="copy-card">
        <strong>Selection policy</strong>
        <p>This ordinary UI sentence should not select accidentally.</p>
        <SelectableText as="p">This marked sentence is intentionally selectable and copyable.</SelectableText>
      </div>
    </Page>
  );
}

function KeyboardPage() {
  const keyboard = useKeyboard();
  const viewport = useViewport();
  const appScroll = document.querySelector<HTMLElement>('[data-hf-scroll-view]')?.scrollTop ?? 0;
  const viewportContract = `${keyboard.phase} · ${keyboard.height.toFixed(0)}px · ${keyboard.source} · scale ${viewport.scale.toFixed(2)} · visual bottom ${((viewport.y + viewport.height) * viewport.scale).toFixed(1)} · offset top ${viewport.y.toFixed(1)} · page top ${viewport.pageTop.toFixed(1)} · app scroll ${appScroll.toFixed(1)} · document scroll ${window.scrollY.toFixed(0)}`;
  return (
    <Page eyebrow="Viewport lab" title="Open, switch, and close the keyboard">
      <div
        className="status-pill"
        data-phase={keyboard.phase}
        aria-label={`Viewport contract: ${viewportContract}`}
      >{viewportContract}</div>
      <p>The top bar must remain visible, the page itself must not slide, and the bottom composer must meet the keyboard.</p>
      <FormRow label="Text"><HomeframeInput type="text" placeholder="Type text" /></FormRow>
      <FormRow label="Search"><HomeframeInput type="search" placeholder="Search without zoom" /></FormRow>
      <FormRow label="Email"><HomeframeInput type="email" placeholder="name@example.com" /></FormRow>
      <FormRow label="Number"><HomeframeInput type="number" inputMode="decimal" placeholder="123.45" /></FormRow>
      <FormRow label="Date"><HomeframeInput type="date" /></FormRow>
      <FormRow label="Select"><HomeframeSelect defaultValue="two"><option value="one">One</option><option value="two">Two</option><option value="three">Three</option></HomeframeSelect></FormRow>
      <FormRow label="Textarea"><HomeframeTextarea rows={5} placeholder="A larger editable region" /></FormRow>
      {Array.from({ length: 8 }, (_, index) => <p key={index} className="filler">Scroll anchor {index + 1}. The focus reveal should move only this content pane.</p>)}
    </Page>
  );
}

function HistoryPage() {
  return (
    <Page eyebrow="History lab" title="Scroll, navigate, then edge-swipe back">
      <p>The shell and header must remain mounted. Each destination uses a real History API entry.</p>
      <div className="history-list">
        {cards.map((card) => (
          <Link key={card.id} to={appPath(`/history/${card.id}`)} className="history-card">
            <span>{card.id}</span><div><strong>{card.title}</strong><p>{card.text}</p></div><b>›</b>
          </Link>
        ))}
      </div>
    </Page>
  );
}

function DetailPage({ match }: { match: RouteMatch }) {
  const id = match.params.id ?? '?';
  const router = useHomeframeRouter();
  return (
    <Page eyebrow="Same-document route" title={`History destination ${id}`}>
      <p>Swipe from the left edge or use the browser back command. The prior list should return to exactly the same scroll position without refreshing.</p>
      <button onClick={() => router.back()}>Go back</button>
      <div className="detail-orbit" aria-hidden="true"><span>{id}</span></div>
    </Page>
  );
}

function PermalinkPage({ match }: { match: RouteMatch }) {
  const router = useHomeframeRouter();
  const permalink = usePermalink();
  const [captured, setCaptured] = useState('');
  const viewValue = (key: string) => {
    const value = permalink.view[key];
    return Array.isArray(value) ? value[0] ?? '' : value ?? '';
  };
  const mode = viewValue('mode') || 'comfortable';
  const filter = viewValue('filter') || 'all';
  const routeView = match.params.view ?? 'unknown';
  const updateView = (key: string, value: string) => {
    void router.navigate(permalink.create({
      view: { [key]: value === 'all' ? null : value },
      scroll: null,
      absolute: false,
    }), { replace: true, preventScrollReset: true });
  };
  const anchoredExample = permalink.create({
    to: appPath('/permalinks/release-board'),
    view: { mode: 'compact', filter: 'keyboard' },
    scroll: { anchor: 'permalink-item-7', offset: 12 },
    absolute: false,
  });
  const visibleItems = filter === 'keyboard'
    ? permalinkItems.filter(item => item.title.startsWith('Keyboard'))
    : permalinkItems;

  return (
    <Page eyebrow="Permalink lab" title={`Cold-launch view: ${routeView}`}>
      <p>
        The path selects the route and view identity, ordinary query parameters
        hold shareable UI state, and the fragment or <code>__hf_scroll</code>
        restores a stable anchor or exact position.
      </p>
      <div className="metric-grid permalink-metrics">
        <Metric label="Route parameter" value={routeView} />
        <Metric label="Scroll target" value={permalink.scroll?.type ?? 'none'} />
      </div>
      <div className="permalink-controls">
        <FormRow label="Layout">
          <HomeframeSelect
            aria-label="Permalink layout"
            value={mode}
            onChange={(event) => updateView('mode', event.target.value)}
          >
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </HomeframeSelect>
        </FormRow>
        <FormRow label="Filter">
          <HomeframeSelect
            aria-label="Permalink filter"
            value={filter}
            onChange={(event) => updateView('filter', event.target.value)}
          >
            <option value="all">All findings</option>
            <option value="keyboard">Keyboard findings</option>
          </HomeframeSelect>
        </FormRow>
        <Link to={anchoredExample} className="button-link">Open the anchored example</Link>
        <button onClick={() => setCaptured(permalink.create({ scroll: 'current' }))}>
          Capture this exact scroll position
        </button>
      </div>
      {captured && (
        <div className="copy-card permalink-output">
          <strong>Share-ready URL</strong>
          <SelectableText as="code">{captured}</SelectableText>
          <Link to={captured} className="button-link">Open captured permalink</Link>
        </div>
      )}
      <div className="permalink-list" data-layout={mode}>
        {visibleItems.map(item => (
          <article
            key={item.id}
            id={`permalink-item-${item.id}`}
            data-hf-permalink-anchor={`permalink-item-${item.id}`}
            className="permalink-item"
          >
            <span>{item.id}</span>
            <div><strong>{item.title}</strong><p>{item.text}</p></div>
          </article>
        ))}
      </div>
    </Page>
  );
}

function PwaPage() {
  const install = useInstallCapability();
  const notifications = useNotificationCapability();
  const update = useHomeframeUpdate();
  const setBadge = useAppBadge();
  const [badgeCount, setBadgeCount] = useState(1);
  const [pushResult, setPushResult] = useState('');
  const sendLocalNotification = async () => {
    const permission = Notification.permission === 'default'
      ? await Notification.requestPermission()
      : Notification.permission;
    if (permission !== 'granted') return;
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification('Homeframe local test', {
      body: 'Tap to return to the PWA lab.',
      icon: appPath('/generated/notification-icon.png'),
      badge: appPath('/generated/notification-badge.png'),
      data: { route: appPath('/pwa') },
    });
  };
  const sendWebPush = async () => {
    setPushResult('Sending…');
    try {
      if (staticDemo) {
        setPushResult('The GitHub Pages demo has no delivery server. Local notifications, permission nudges, and worker routing still run here.');
        return;
      }
      const response = await fetch(appPath('/api/push/send'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Homeframe end-to-end push',
          body: 'Delivered through the Push API and Homeframe service worker.',
          route: appPath('/pwa'),
          badgeCount,
        }),
      });
      const result = await response.json() as { sent?: number; failed?: number; error?: string };
      if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status})`);
      setPushResult(`Sent ${result.sent ?? 0}; failed ${result.failed ?? 0}.`);
    } catch (reason) {
      setPushResult(reason instanceof Error ? reason.message : String(reason));
    }
  };
  return (
    <Page eyebrow="Capability lab" title="Install, notify, badge, update, recover">
      <CapabilityCard title="Install" state={install.state} blockers={install.blockers}>
        <button disabled={install.installed} onClick={() => void install.prompt()}>{install.installed ? 'Installed' : 'Install or show steps'}</button>
      </CapabilityCard>
      <CapabilityCard title="Notifications" state={notifications.state} blockers={notifications.blockers}>
        <button onClick={() => void notifications.requestAndSubscribe()}>Enable push</button>
        <button onClick={() => void sendLocalNotification()}>Send local test</button>
        <button disabled={!staticDemo && notifications.state !== 'subscribed'} onClick={() => void sendWebPush()}>{staticDemo ? 'About server push' : 'Send real web push'}</button>
        {pushResult && <SelectableText as="p">{pushResult}</SelectableText>}
        {notifications.error && <SelectableText as="p" className="error-text">{notifications.error}</SelectableText>}
      </CapabilityCard>
      <CapabilityCard title="App badge" state={`${badgeCount}`} blockers={[]}>
        <button onClick={() => { void setBadge(badgeCount); setBadgeCount((value) => value + 1); }}>Set & increment</button>
        <button onClick={() => void setBadge()}>Clear</button>
      </CapabilityCard>
      <CapabilityCard title="Bundle update" state={update.state} blockers={update.error ? [update.error] : []}>
        <button onClick={() => void update.check()}>Check</button>
        <button disabled={update.state !== 'ready' && update.state !== 'deferred'} onClick={() => void update.activate()}>Activate</button>
      </CapabilityCard>
    </Page>
  );
}

function SettingsPage() {
  const [name, setName] = useStateCheckpoint({ key: 'settings-name', storage: 'local', initialValue: '' });
  const theme = useThemePreference();
  return (
    <Page eyebrow="Persistence lab" title="Settings survive process death">
      <FormRow label="Appearance">
        <HomeframeSelect
          aria-label="Appearance"
          value={theme.preference}
          onChange={(event) => theme.setPreference(event.target.value as ThemePreference)}
        >
          <option value="system">System (default)</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </HomeframeSelect>
      </FormRow>
      <p>Using {theme.preference === 'system' ? `the system’s ${theme.resolved} appearance` : `${theme.resolved} appearance`} across the app shell, browser metadata, and native form controls.</p>
      <FormRow label="Display name"><HomeframeInput value={name} onChange={(event) => setName(event.target.value)} placeholder="Stored locally" /></FormRow>
      <p>Close the installed PWA, allow iOS to terminate it, then relaunch. This non-sensitive sample setting should restore.</p>
      <Link to={appPath()} className="button-link">Done</Link>
    </Page>
  );
}

function CapabilityNudges() {
  const install = useInstallCapability();
  const notifications = useNotificationCapability();
  useEffect(() => {
    if (install.eligible) install.recordImpression();
  }, [install.eligible]);
  useEffect(() => {
    if (notifications.eligible) notifications.recordImpression();
  }, [notifications.eligible]);
  if (install.eligible) {
    const instructions = install.platformHint === 'ios'
      ? 'Use Share, then Add to Home Screen for the full iPhone PWA experience.'
      : 'Install it in its own app window with offline support.';
    return (
      <div className="nudge" role="region" aria-label="Install Homeframe">
        <div><strong>Install Homeframe as an app</strong><span>{instructions}</span></div>
        <button onClick={() => void install.prompt()}>Continue</button>
        <button className="quiet" aria-label="Dismiss" onClick={() => install.snooze(1)}>×</button>
      </div>
    );
  }
  if (notifications.eligible) {
    return (
      <div className="nudge" role="region" aria-label="Enable notifications">
        <div><strong>Enable test notifications</strong><span>The native prompt appears only after you continue.</span></div>
        <button onClick={() => void notifications.requestAndSubscribe()}>Continue</button>
        <button className="quiet" aria-label="Dismiss" onClick={() => notifications.snooze(1)}>×</button>
      </div>
    );
  }
  return null;
}

function UpdateNotice() {
  const update = useHomeframeUpdate();
  if (update.state !== 'ready' && update.state !== 'deferred') return null;
  return <div className="update-toast"><span>Build {update.availableBuild ?? 'new'} is ready.</span><button onClick={() => void update.activate()}>Update</button></div>;
}

function OfflinePage() {
  return <div className="offline-page"><span>⌁</span><h1>You’re offline</h1><p>The Homeframe shell is cached and ready. Reconnect to load network data.</p></div>;
}

function NotFoundPage() {
  return <Page eyebrow="404" title="Route not found"><Link to={appPath()}>Return home</Link></Page>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function FeatureLink({ to, icon, title, children }: { to: string; icon: string; title: string; children: ReactNode }) {
  return <Link to={to} className="feature-link"><span>{icon}</span><div><strong>{title}</strong><p>{children}</p></div><b>›</b></Link>;
}

function FormRow({ label, children }: { label: string; children: ReactNode }) {
  return <label className="form-row"><span>{label}</span>{children}</label>;
}

function CapabilityCard({ title, state, blockers, children }: { title: string; state: string; blockers: string[]; children: ReactNode }) {
  return <section className="capability-card"><header><strong>{title}</strong><code>{state}</code></header>{blockers.length > 0 && <p>{blockers.join(', ')}</p>}<div>{children}</div></section>;
}
