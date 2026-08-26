import { useEffect, useRef, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  AppScrollView,
  AppShell,
  AppSidebarLabel,
  AppViewport,
  FloatingWindow,
  HomeframeErrorBoundary,
  HomeframeInput,
  HomeframeNudgeProvider,
  HomeframeProvider,
  HomeframeReadinessProvider,
  SelectableText,
  ViewportDock,
  ViewportAttachment,
  useAppSidebar,
  useHomeframeReadiness,
  useHomeframeLogout,
  useHomeframeUpdate,
  useNudgeCoordinator,
} from '@builtbyted/react';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  document.documentElement.dataset.hfReady = 'true';
  document.documentElement.dataset.hfKeyboard = 'closed';
  delete document.documentElement.dataset.hfError;
  delete document.documentElement.dataset.hfModal;
  delete document.documentElement.dataset.hfPrompt;
  delete document.documentElement.dataset.hfNudges;
  delete document.documentElement.dataset.hfCriticalTask;
  history.replaceState({}, '', '/');
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

describe('React shell primitives', () => {
  it('completes logout cleanup when no service-worker registration exists', async () => {
    const getRegistration = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistration },
    });
    function LogoutHarness() {
      const logout = useHomeframeLogout();
      const [complete, setComplete] = useState(false);
      return (
        <button type="button" onClick={() => void logout().then(() => setComplete(true))}>
          {complete ? 'Complete' : 'Log out'}
        </button>
      );
    }
    render(
      <HomeframeProvider config={{ serviceWorker: false }}>
        <LogoutHarness />
      </HomeframeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Complete' })).toBeVisible());
    expect(getRegistration).toHaveBeenCalledOnce();
  });

  it('renders the fixed shell regions and portal root', () => {
    const { container } = render(
      <HomeframeProvider config={{ serviceWorker: false }}>
        <AppViewport>
          <AppShell header={<div>Header</div>} bottom={<div>Bottom</div>}>
            <AppScrollView><div>Content</div></AppScrollView>
          </AppShell>
        </AppViewport>
      </HomeframeProvider>,
    );
    expect(container.querySelector('[data-hf-viewport]')).not.toBeNull();
    expect(container.querySelector('[data-hf-header]')).toHaveTextContent('Header');
    expect(container.querySelector('[data-hf-scroll-view]')).toHaveTextContent('Content');
    expect(container.querySelector('[data-hf-dock]')).toHaveTextContent('Bottom');
    expect(container.querySelector('[data-hf-portals]')).not.toBeNull();
  });

  it('portals a floating window above shell chrome and owns modal focus lifecycle', async () => {
    function FloatingWindowHarness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <div data-hf-shell="">
            <button type="button" onClick={() => setOpen(true)}>Open Mark</button>
          </div>
          <div data-hf-portals="" />
          <FloatingWindow
            open={open}
            placement="bottom-start"
            mobilePresentation="fullscreen"
            aria-label="Mark"
            onDismiss={() => setOpen(false)}
          >
            <button type="button">Inside Mark</button>
          </FloatingWindow>
        </>
      );
    }

    const { container } = render(<FloatingWindowHarness />);
    const trigger = screen.getByRole('button', { name: 'Open Mark' });
    trigger.focus();
    fireEvent.click(trigger);
    const floatingWindow = await screen.findByRole('dialog', { name: 'Mark' });
    expect(floatingWindow.closest('[data-hf-portals]')).not.toBeNull();
    expect(floatingWindow.closest('[data-hf-floating-placement="bottom-start"]')).not.toBeNull();
    expect(floatingWindow).toHaveAttribute('data-hf-keyboard-surface');
    expect(floatingWindow.parentElement).toHaveAttribute('data-hf-keyboard-surface');
    expect(document.documentElement.dataset.hfModal).toBe('open');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Inside Mark' })).toHaveFocus());

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(container.querySelector('[data-hf-floating-window]')).toBeNull());
    expect(document.documentElement.dataset.hfModal).toBeUndefined();
    expect(trigger).toHaveFocus();
  });

  it('dismisses a non-modal floating window on Escape without trapping focus', async () => {
    function NonModalFloatingWindowHarness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open inspector</button>
          <div data-hf-portals="" />
          <FloatingWindow
            open={open}
            modal={false}
            aria-label="Inspector"
            onDismiss={() => setOpen(false)}
          >
            <button type="button">Inspector action</button>
          </FloatingWindow>
        </>
      );
    }

    const { container } = render(<NonModalFloatingWindowHarness />);
    const trigger = screen.getByRole('button', { name: 'Open inspector' });
    trigger.focus();
    fireEvent.click(trigger);
    await screen.findByRole('dialog', { name: 'Inspector' });
    expect(document.documentElement.dataset.hfModal).toBeUndefined();
    expect(trigger).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(container.querySelector('[data-hf-floating-window]')).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it('supports an existing shell with explicit measured primitive composition', () => {
    const { container } = render(
      <HomeframeProvider config={{ serviceWorker: false }}>
        <AppViewport>
          <AppShell manualComposition className="existing-shell">
            <div className="existing-stage">
              <AppScrollView>Content</AppScrollView>
            </div>
            <ViewportDock>Navigation</ViewportDock>
          </AppShell>
        </AppViewport>
      </HomeframeProvider>,
    );
    const shell = container.querySelector('[data-hf-shell]');
    expect(shell).toHaveClass('existing-shell');
    expect(shell).toHaveAttribute('data-hf-manual-composition');
    expect(shell?.querySelector('[data-hf-content]')).toBeNull();
    expect(shell?.querySelector('[data-hf-scroll-view]')).toHaveTextContent('Content');
    expect(shell?.querySelector('[data-hf-dock]')).toHaveTextContent('Navigation');
  });

  it('keeps a shell as the direct viewport child through the error boundary', () => {
    const { container } = render(
      <HomeframeProvider config={{ serviceWorker: false }}>
        <AppViewport>
          <HomeframeErrorBoundary fallback={<div>Recovery</div>}>
            <AppShell manualComposition>Content</AppShell>
          </HomeframeErrorBoundary>
        </AppViewport>
      </HomeframeProvider>,
    );
    const viewport = container.querySelector('[data-hf-viewport]')!;
    const shell = container.querySelector('[data-hf-shell]')!;
    expect(viewport.firstElementChild).toBe(shell);
  });

  it('combines overlay placement with keyboard avoidance', () => {
    const { container } = render(
      <ViewportDock placement="overlay" keyboard="avoid">Search</ViewportDock>,
    );
    const dock = container.querySelector('[data-hf-dock]');
    expect(dock).toHaveAttribute('data-hf-dock-placement', 'overlay');
    expect(dock).toHaveAttribute('data-keyboard-policy', 'avoid');
  });

  it('measures viewport attachments and exposes AppShell convenience slots', () => {
    const { container } = render(
      <HomeframeProvider config={{ serviceWorker: false }}>
        <AppViewport>
          <AppShell
            header={<div>Header</div>}
            headerAttachment={<div>Video</div>}
            bottom={<div>Navigation</div>}
            bottomAttachment={<div>Search</div>}
            bottomAttachmentKeyboard="avoid"
          >
            <AppScrollView>Content</AppScrollView>
          </AppShell>
        </AppViewport>
      </HomeframeProvider>,
    );
    const attachments = container.querySelectorAll('[data-hf-viewport-attachment]');
    expect(container.querySelector('[data-hf-shell]')).toHaveAttribute('data-hf-has-dock', 'true');
    expect(container.querySelector('[data-hf-shell]')).toHaveAttribute(
      'data-hf-bottom-keyboard-policy',
      'avoid',
    );
    expect(attachments).toHaveLength(2);
    expect(attachments[0]).toHaveAttribute('data-hf-attachment-anchor', 'header');
    expect(attachments[0]).toHaveAttribute('data-keyboard-policy', 'manual');
    expect(attachments[1]).toHaveAttribute('data-hf-attachment-anchor', 'dock');
    expect(attachments[1]).toHaveAttribute('data-keyboard-policy', 'avoid');
  });

  it('exposes a keyboard-covered dock policy for independently avoiding attachments', () => {
    const { container } = render(
      <HomeframeProvider config={{ serviceWorker: false }}>
        <AppViewport>
          <AppShell
            bottom={<nav>Navigation</nav>}
            bottomKeyboard="manual"
            bottomAttachment={<input aria-label="Composer" />}
            bottomAttachmentKeyboard="avoid"
          >
            Content
          </AppShell>
        </AppViewport>
      </HomeframeProvider>,
    );
    expect(container.querySelector('[data-hf-shell]')).toHaveAttribute(
      'data-hf-bottom-keyboard-policy',
      'manual',
    );
    expect(container.querySelector('[data-hf-dock]')).toHaveAttribute(
      'data-keyboard-policy',
      'manual',
    );
  });

  it('marks when a bottom attachment must own the safe bottom', () => {
    const { container } = render(
      <HomeframeProvider config={{ serviceWorker: false }}>
        <AppViewport>
          <AppShell bottomAttachment={<div>Search</div>}>
            <AppScrollView>Content</AppScrollView>
          </AppShell>
        </AppViewport>
      </HomeframeProvider>,
    );
    expect(container.querySelector('[data-hf-shell]')).toHaveAttribute('data-hf-has-dock', 'false');
    expect(container.querySelector('[data-hf-dock]')).toBeNull();
  });

  it('allows direct viewport attachment composition', () => {
    const { container } = render(
      <ViewportAttachment anchor="dock" keyboard="hide">Controls</ViewportAttachment>,
    );
    expect(container.firstElementChild).toHaveAttribute('data-keyboard-policy', 'hide');
  });

  it('supports expanded, icon-rail, and hidden desktop sidebars with a pinned footer', () => {
    const { container } = render(
      <HomeframeProvider config={{ serviceWorker: false }}>
        <AppViewport>
          <AppShell
            header={<div>Header</div>}
            headerPlacement="full"
            sidebarStorageKey="test:sidebar-mode"
            sidebar={<nav><AppSidebarLabel>Dashboard</AppSidebarLabel></nav>}
            sidebarFooter={<SidebarControls />}
          >
            <div>Content</div>
          </AppShell>
        </AppViewport>
      </HomeframeProvider>,
    );
    const shell = container.querySelector('[data-hf-shell]')!;
    const sidebar = container.querySelector('[data-hf-sidebar]')!;
    expect(shell).toHaveAttribute('data-hf-desktop-layout', 'true');
    expect(shell).toHaveAttribute('data-hf-header-placement', 'full');
    expect(shell).toHaveAttribute('data-hf-sidebar-mode', 'expanded');
    expect(sidebar).toHaveTextContent('Dashboard');
    expect(container.querySelector('[data-hf-sidebar-footer]')).toHaveTextContent('Sidebar controls');

    fireEvent.click(screen.getByRole('button', { name: 'Use icon rail' }));
    expect(shell).toHaveAttribute('data-hf-sidebar-mode', 'rail');
    expect(localStorage.getItem('test:sidebar-mode')).toBe('rail');

    fireEvent.click(screen.getByRole('button', { name: 'Hide sidebar' }));
    expect(shell).toHaveAttribute('data-hf-sidebar-mode', 'hidden');
    expect(sidebar).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Show navigation' }));
    expect(shell).toHaveAttribute('data-hf-sidebar-mode', 'expanded');
    expect(sidebar).not.toHaveAttribute('aria-hidden');
  });

  it('enforces editable text sizing and marks intentional selection', () => {
    const { container } = render(
      <HomeframeProvider config={{ serviceWorker: false }}>
        <AppViewport>
          <HomeframeInput aria-label="Name" style={{ color: 'red' }} />
          <SelectableText>Copy me</SelectableText>
        </AppViewport>
      </HomeframeProvider>,
    );
    expect(screen.getByLabelText('Name')).toHaveAttribute('data-hf-input');
    const inlineStyle = screen.getByLabelText('Name').getAttribute('style') ?? '';
    expect(inlineStyle).toContain('color: red');
    expect(container.querySelector('[data-hf-selectable]')).toHaveTextContent('Copy me');
  });

  it('keeps service-worker actions stable across update snapshots and rerenders', async () => {
    render(
      <HomeframeProvider>
        <UpdateGuardHarness />
      </HomeframeProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('guard-count')).toHaveTextContent('1'));
    fireEvent.click(screen.getByRole('button', { name: 'Rerender guard' }));
    expect(screen.getByTestId('guard-count')).toHaveTextContent('1');
    expect(screen.getByTestId('guard-registrations')).toHaveTextContent('1');
  });

  it('preserves a shared route scroller for URL-only modal replacements', () => {
    const view = render(
      <AppScrollView scrollKey="route-one" navigationType="push">
        <div>Gallery</div>
      </AppScrollView>,
    );
    const scroller = view.container.querySelector<HTMLElement>('[data-hf-scroll-view]')!;
    scroller.scrollTop = 240;
    fireEvent.scroll(scroller);

    view.rerender(
      <AppScrollView
        scrollKey="route-one"
        navigationType="replace"
        scrollBehavior="preserve"
      >
        <div>Gallery modal open</div>
      </AppScrollView>,
    );
    expect(scroller.scrollTop).toBe(240);
  });

  it('restores scroll when route-scoped scroll views unmount and remount', () => {
    const view = render(
      <AppScrollView key="one" scrollKey="remounted-route-one" navigationType="push">
        <div>First route</div>
      </AppScrollView>,
    );
    view.container.querySelector<HTMLElement>('[data-hf-scroll-view]')!.scrollTop = 275;

    view.rerender(
      <AppScrollView key="two" scrollKey="remounted-route-two" navigationType="push">
        <div>Second route</div>
      </AppScrollView>,
    );
    view.rerender(
      <AppScrollView key="one-again" scrollKey="remounted-route-one" navigationType="back">
        <div>First route restored</div>
      </AppScrollView>,
    );

    expect(view.container.querySelector<HTMLElement>('[data-hf-scroll-view]')!.scrollTop).toBe(275);
  });

  it('applies an explicit cold-launch permalink scroll position', () => {
    const view = render(
      <AppScrollView
        scrollKey="permalink-entry"
        navigationType="reload"
        permalinkScroll={{ type: 'position', top: 640 }}
      >
        <div style={{ height: 2000 }}>Permalink destination</div>
      </AppScrollView>,
    );
    expect(view.container.querySelector<HTMLElement>('[data-hf-scroll-view]')!.scrollTop).toBe(640);
  });

  it('reveals a page field above the measured keyboard occlusion', async () => {
    const view = render(
      <HomeframeProvider config={{ serviceWorker: false }}>
        <AppViewport>
          <AppScrollView><HomeframeInput aria-label="Covered field" /></AppScrollView>
        </AppViewport>
      </HomeframeProvider>,
    );
    const viewport = view.container.querySelector<HTMLElement>('[data-hf-viewport]')!;
    const scroller = view.container.querySelector<HTMLElement>('[data-hf-scroll-view]')!;
    const input = screen.getByLabelText('Covered field');
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({
      top: 0, right: 390, bottom: 800, left: 0, width: 390, height: 800, x: 0, y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({
      top: 80, right: 390, bottom: 740, left: 0, width: 390, height: 660, x: 0, y: 80,
      toJSON: () => ({}),
    });
    vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({
      top: 610, right: 370, bottom: 650, left: 20, width: 350, height: 40, x: 20, y: 610,
      toJSON: () => ({}),
    });
    const scrollBy = vi.spyOn(scroller, 'scrollBy');
    document.documentElement.style.setProperty('--hf-keyboard-height', '300px');
    input.focus();
    window.dispatchEvent(new CustomEvent('homeframe:viewport-change'));
    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(scrollBy).toHaveBeenCalledWith({ top: 162, behavior: 'smooth' });
    document.documentElement.style.removeProperty('--hf-keyboard-height');
  });

  it('prioritizes only an actually eligible install nudge and releases notifications after permanent dismissal', async () => {
    render(
      <HomeframeNudgeProvider config={{
        install: { minSessions: 1, minEngagedMs: 0, cooldownDays: 0, maxImpressions: 3 },
        notifications: { minSessions: 1, minEngagedMs: 0, cooldownDays: 0, maxImpressions: 3 },
      }}>
        <NudgeHarness />
      </HomeframeNudgeProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('install-eligible')).toHaveTextContent('true'));
    expect(screen.getByTestId('notification-eligible')).toHaveTextContent('false');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss install permanently' }));
    await waitFor(() => expect(screen.getByTestId('install-eligible')).toHaveTextContent('false'));
    expect(screen.getByTestId('notification-eligible')).toHaveTextContent('true');
  });

  it('keeps the current nudge eligible after recording its impression', async () => {
    render(
      <HomeframeNudgeProvider config={{
        install: { minSessions: 1, minEngagedMs: 0, cooldownDays: 1, maxImpressions: 3 },
      }}>
        <NudgeHarness />
      </HomeframeNudgeProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('install-eligible')).toHaveTextContent('true'));
    fireEvent.click(screen.getByRole('button', { name: 'Record install impression' }));
    await waitFor(() => expect(screen.getByTestId('install-eligible')).toHaveTextContent('true'));
  });

  it('suppresses all nudges while an app-defined critical task is active', async () => {
    let release: () => void = () => undefined;
    render(
      <HomeframeNudgeProvider config={{
        install: { minSessions: 1, minEngagedMs: 0, cooldownDays: 0, maxImpressions: 3 },
      }}>
        <NudgeHarness onCriticalTask={(nextRelease) => { release = nextRelease; }} />
      </HomeframeNudgeProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('install-eligible')).toHaveTextContent('true'));
    fireEvent.click(screen.getByRole('button', { name: 'Start critical task' }));
    await waitFor(() => expect(screen.getByTestId('install-eligible')).toHaveTextContent('false'));
    act(() => release());
    await waitFor(() => expect(screen.getByTestId('install-eligible')).toHaveTextContent('true'));
  });

  it('resets cooldown counters on a policy version change but preserves permanent denial', async () => {
    localStorage.setItem('hf:nudges:install', JSON.stringify({
      impressions: 99,
      lastShownAt: Date.now(),
      snoozedUntil: Date.now() + 999_999,
      permanent: false,
      success: false,
      policyVersion: 'old',
    }));
    const first = render(
      <HomeframeNudgeProvider config={{
        policyVersion: 'new',
        install: { minSessions: 1, minEngagedMs: 0, cooldownDays: 0, maxImpressions: 1 },
      }}>
        <NudgeHarness />
      </HomeframeNudgeProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('install-eligible')).toHaveTextContent('true'));
    first.unmount();

    localStorage.setItem('hf:nudges:install', JSON.stringify({
      impressions: 0,
      lastShownAt: null,
      snoozedUntil: null,
      permanent: true,
      success: false,
      policyVersion: 'old',
    }));
    render(
      <HomeframeNudgeProvider config={{
        policyVersion: 'new',
        install: { minSessions: 1, minEngagedMs: 0, cooldownDays: 0, maxImpressions: 1 },
      }}>
        <NudgeHarness />
      </HomeframeNudgeProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('install-eligible')).toHaveTextContent('false'));
  });

  it('applies route and network policy without treating navigator.onLine as permission', async () => {
    history.replaceState({}, '', '/allowed');
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    render(
      <HomeframeNudgeProvider config={{
        install: { minSessions: 1, minEngagedMs: 0, routes: ['/allowed'], requiresNetwork: false },
        notifications: { minSessions: 1, minEngagedMs: 0, routes: ['/allowed'], requiresNetwork: true },
      }}>
        <NudgeHarness installCandidate={false} />
      </HomeframeNudgeProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('notification-eligible')).toHaveTextContent('false'));
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    act(() => window.dispatchEvent(new Event('online')));
    await waitFor(
      () => expect(screen.getByTestId('notification-eligible')).toHaveTextContent('true'),
      { timeout: 3_000 },
    );
  });

  it('turns an abandoned readiness hold into a recoverable branded failure', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <HomeframeReadinessProvider>
        <ReadinessHarness />
      </HomeframeReadinessProvider>,
    );
    act(() => vi.advanceTimersByTime(15_000));
    expect(screen.getByRole('alert')).toHaveTextContent('restore-session');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
    expect(document.documentElement.dataset.hfReadinessError).toBe('true');
    expect(error).toHaveBeenCalledWith(expect.stringContaining('HF_READINESS_TIMEOUT'), expect.any(String));
    vi.useRealTimers();
  });
});

function NudgeHarness({
  onCriticalTask,
  installCandidate = true,
}: {
  onCriticalTask?: (release: () => void) => void;
  installCandidate?: boolean;
}) {
  const nudges = useNudgeCoordinator();
  useEffect(() => {
    nudges.setCandidate('install', installCandidate);
    nudges.setCandidate('notifications', true);
  }, [installCandidate, nudges.setCandidate]);
  return (
    <div>
      <output data-testid="install-eligible">{String(nudges.eligible('install', nudges.config.install))}</output>
      <output data-testid="notification-eligible">{String(nudges.eligible('notifications', nudges.config.notifications))}</output>
      <button onClick={() => nudges.dismiss('install', true)}>Dismiss install permanently</button>
      <button onClick={() => nudges.impression('install')}>Record install impression</button>
      <button onClick={() => onCriticalTask?.(nudges.registerCriticalTask('checkout'))}>Start critical task</button>
    </div>
  );
}

function SidebarControls() {
  const sidebar = useAppSidebar();
  return (
    <div>
      <span>Sidebar controls</span>
      <button onClick={() => sidebar.setMode('rail')}>Use icon rail</button>
      <button onClick={() => sidebar.setMode('hidden')}>Hide sidebar</button>
    </div>
  );
}

function ReadinessHarness() {
  const readiness = useHomeframeReadiness();
  useEffect(() => readiness.hold('restore-session'), []);
  return <div>Application boot</div>;
}

function UpdateGuardHarness() {
  const update = useHomeframeUpdate();
  const registrations = useRef(0);
  const [, rerender] = useState(0);
  useEffect(() => {
    registrations.current += 1;
    return update.registerGuard(() => true);
  }, [update.registerGuard]);
  return (
    <div>
      <output data-testid="guard-count">{update.guardCount}</output>
      <output data-testid="guard-registrations">{registrations.current}</output>
      <button onClick={() => rerender(value => value + 1)}>Rerender guard</button>
    </div>
  );
}
