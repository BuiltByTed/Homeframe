import {
  createContext, forwardRef, useContext, useEffect, useLayoutEffect, useRef, useState,
  type CSSProperties, type HTMLAttributes, type ReactNode, type RefObject,
} from 'react';
import { publishModalState } from './modal-state.js';

export type SidePanelSide = 'left' | 'right';
export type SidePanelPresentation = 'push' | 'overlay' | 'fullscreen';

export interface SidePanelProps extends HTMLAttributes<HTMLElement> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: SidePanelSide;
  /** Panel width in CSS pixels when there is room. Defaults to 400. */
  width?: number;
  /** Minimum space left for the entire app before switching to overlay. Defaults to 720. */
  minAppWidth?: number;
  /** Below this available width the panel fills the UI. Defaults to 768. */
  mobileBreakpoint?: number;
  header?: ReactNode;
  footer?: ReactNode;
  closeLabel?: string;
  dismissOnBackdrop?: boolean;
  dismissOnEscape?: boolean;
}

const SidePanelLayoutContext = createContext<{
  width: number;
  app: RefObject<HTMLDivElement | null>;
} | null>(null);

/** AppShell owns this stable layout; opening a panel never reparents the shell. */
export function SidePanelLayout({ children, panel }: { children: ReactNode; panel: ReactNode }) {
  const layout = useRef<HTMLDivElement>(null);
  const app = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = layout.current!;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <SidePanelLayoutContext.Provider value={{ width, app }}>
      <div ref={layout} data-hf-side-panel-layout="">
        <div ref={app} data-hf-side-panel-app="">{children}</div>
        {panel}
      </div>
    </SidePanelLayoutContext.Provider>
  );
}

const focusableSelector = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** A general-purpose, full-height panel composed through AppShell.sidePanel. */
export const SidePanel = forwardRef<HTMLElement, SidePanelProps>(function SidePanel({
  open, onOpenChange, side = 'right', width = 400, minAppWidth = 720,
  mobileBreakpoint = 768, header, footer, closeLabel = 'Close panel',
  dismissOnBackdrop = true, dismissOnEscape = true, children, style, ...props
}, forwardedRef) {
  const layout = useContext(SidePanelLayoutContext);
  if (!layout) throw new Error('Compose SidePanel through the AppShell sidePanel slot.');
  const panelWidth = Number.isFinite(width) && width > 0 ? width : 400;
  const minimumApp = Number.isFinite(minAppWidth) && minAppWidth >= 0 ? minAppWidth : 720;
  const mobileWidth = Number.isFinite(mobileBreakpoint) && mobileBreakpoint > 0 ? mobileBreakpoint : 768;
  const presentation: SidePanelPresentation = layout.width < mobileWidth
    ? 'fullscreen'
    : layout.width < panelWidth + minimumApp ? 'overlay' : 'push';
  const modal = open && presentation !== 'push';
  const panel = useRef<HTMLElement>(null);
  const actions = useRef({ onOpenChange, dismissOnEscape });
  useLayoutEffect(() => { actions.current = { onOpenChange, dismissOnEscape }; });

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = panel.current!;
    const frame = requestAnimationFrame(() => element.focus({ preventScroll: true }));
    return () => {
      cancelAnimationFrame(frame);
      // Leave focus alone when a non-modal panel's user has already returned to the app.
      if ((element.contains(document.activeElement) || document.activeElement === document.body)
        && previous?.isConnected) queueMicrotask(() => {
        if (previous.isConnected && !previous.closest('[inert]')) previous.focus({ preventScroll: true });
      });
    };
  }, [open]);

  useEffect(() => {
    if (!modal) return;
    const app = layout.app.current!;
    const wasInert = app.inert;
    app.inert = true;
    publishModalState(true);
    if (!panel.current?.contains(document.activeElement)) panel.current?.focus({ preventScroll: true });
    return () => {
      app.inert = wasInert;
      publishModalState(false);
    };
  }, [modal, layout.app]);

  useEffect(() => {
    if (!open) return;
    const element = panel.current!;
    const focusable = () => [...element.querySelectorAll<HTMLElement>(focusableSelector)]
      .filter((item) => !item.closest('[hidden], [inert], [aria-hidden="true"]')
        && getComputedStyle(item).display !== 'none' && getComputedStyle(item).visibility !== 'hidden');
    const inChildWindow = () => document.activeElement instanceof Element
      && Boolean(document.activeElement.closest('[data-hf-floating-window]'));
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || inChildWindow()) return;
      if (event.key === 'Escape' && actions.current.dismissOnEscape
        && (modal || element.contains(document.activeElement))) {
        event.preventDefault();
        actions.current.onOpenChange(false);
      }
      if (!modal || event.key !== 'Tab') return;
      const items = focusable();
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) {
        event.preventDefault();
        element.focus({ preventScroll: true });
      } else if (!element.contains(document.activeElement) || document.activeElement === element
        || (event.shiftKey && document.activeElement === first)
        || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ preventScroll: true });
      }
    };
    const focusin = () => {
      if (modal && !element.contains(document.activeElement) && !inChildWindow()) {
        element.focus({ preventScroll: true });
      }
    };
    window.addEventListener('keydown', keydown);
    document.addEventListener('focusin', focusin);
    return () => {
      window.removeEventListener('keydown', keydown);
      document.removeEventListener('focusin', focusin);
    };
  }, [modal, open]);

  return (
    <div
      data-hf-side-panel-layer=""
      data-hf-side-panel-side={side}
      data-hf-side-panel-open={String(open)}
      data-hf-side-panel-presentation={presentation}
      style={{ '--hf-side-panel-width': `${panelWidth}px` } as CSSProperties}
    >
      {modal ? <div data-hf-side-panel-backdrop="" aria-hidden="true"
        onClick={() => { if (dismissOnBackdrop) onOpenChange(false); }} /> : null}
      <section
        {...props}
        ref={(element) => {
          panel.current = element;
          if (typeof forwardedRef === 'function') forwardedRef(element);
          else if (forwardedRef) forwardedRef.current = element;
        }}
        style={style}
        data-hf-side-panel=""
        data-hf-keyboard-surface=""
        role={modal ? 'dialog' : 'complementary'}
        aria-label={props['aria-label'] ?? (props['aria-labelledby'] ? undefined : 'Side panel')}
        aria-modal={modal || undefined}
        aria-hidden={!open || undefined}
        inert={!open || undefined}
        tabIndex={-1}
      >
        <div data-hf-side-panel-header="">
          <div>{header}</div>
          <button type="button" aria-label={closeLabel} onClick={() => onOpenChange(false)}>{closeLabel}</button>
        </div>
        <div data-hf-side-panel-content="" data-hf-keyboard-scroll="">{children}</div>
        {footer == null ? null : <div data-hf-side-panel-footer="">{footer}</div>}
      </section>
    </div>
  );
});
