import { detectDisplayMode } from './viewport.js';
import { emitRuntimeEvent } from './events.js';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface NavigatorStandalone extends Navigator {
  standalone?: boolean;
}

export type InstallState =
  | 'checking'
  | 'installed'
  | 'native-prompt-ready'
  | 'manual-instructions'
  | 'unavailable';

export interface InstallInstructions {
  kind: 'ios-add-to-home-screen' | 'browser-menu';
  steps: Array<'open-share-or-menu' | 'choose-add-to-home-screen' | 'confirm-install'>;
}

export interface InstallSnapshot {
  state: InstallState;
  platformHint: 'ios' | 'chromium' | 'other';
  instructions: InstallInstructions | null;
  installed: boolean;
  revision: number;
}

function isIosLike(): boolean {
  if (typeof navigator === 'undefined') return false;
  const touchMac = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || touchMac;
}

function platformHint(): InstallSnapshot['platformHint'] {
  if (isIosLike()) return 'ios';
  if (typeof navigator !== 'undefined' && /Chrom(e|ium)|Edg\//.test(navigator.userAgent)) {
    return 'chromium';
  }
  return 'other';
}

export class InstallController {
  private deferredPrompt: BeforeInstallPromptEvent | null = null;
  private listeners = new Set<() => void>();
  private abortController: AbortController | null = null;
  private snapshot: InstallSnapshot = {
    state: 'checking',
    platformHint: 'other',
    instructions: null,
    installed: false,
    revision: 0,
  };

  getSnapshot = (): InstallSnapshot => this.snapshot;
  getServerSnapshot = (): InstallSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start(): () => void {
    if (typeof window === 'undefined') return () => undefined;
    if (this.abortController) return () => this.stop();
    this.abortController = new AbortController();
    const { signal } = this.abortController;
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      this.deferredPrompt = event as BeforeInstallPromptEvent;
      this.recompute();
    }, { signal });
    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      this.publish('installed', null, true);
    }, { signal });
    for (const mode of ['standalone', 'fullscreen', 'minimal-ui']) {
      window.matchMedia(`(display-mode: ${mode})`).addEventListener('change', () => {
        this.recompute();
      }, { signal });
    }
    this.recompute();
    return () => this.stop();
  }

  stop(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  async prompt(): Promise<'accepted' | 'dismissed' | 'instructions-required'> {
    if (this.snapshot.state === 'manual-instructions') return 'instructions-required';
    if (!this.deferredPrompt) return 'dismissed';
    const promptEvent = this.deferredPrompt;
    this.deferredPrompt = null;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    this.recompute();
    return choice.outcome;
  }

  private recompute(): void {
    const installed = detectDisplayMode() !== 'browser'
      || (navigator as NavigatorStandalone).standalone === true;
    const hint = platformHint();
    if (installed) {
      this.publish('installed', null, true);
    } else if (this.deferredPrompt) {
      this.publish('native-prompt-ready', null, false);
    } else if (hint === 'ios') {
      this.publish('manual-instructions', {
        kind: 'ios-add-to-home-screen',
        steps: ['open-share-or-menu', 'choose-add-to-home-screen', 'confirm-install'],
      }, false);
    } else {
      this.publish('unavailable', hint === 'other' ? {
        kind: 'browser-menu',
        steps: ['open-share-or-menu', 'choose-add-to-home-screen', 'confirm-install'],
      } : null, false);
    }
  }

  private publish(
    state: InstallState,
    instructions: InstallInstructions | null,
    installed: boolean,
  ): void {
    const next: InstallSnapshot = {
      state,
      instructions,
      installed,
      platformHint: platformHint(),
      revision: this.snapshot.revision + 1,
    };
    if (JSON.stringify({ ...next, revision: 0 }) === JSON.stringify({ ...this.snapshot, revision: 0 })) {
      return;
    }
    this.snapshot = next;
    for (const listener of this.listeners) listener();
    emitRuntimeEvent('install-capability-change', next);
  }
}

let defaultInstallController: InstallController | null = null;

export function getInstallController(): InstallController {
  defaultInstallController ??= new InstallController();
  return defaultInstallController;
}
