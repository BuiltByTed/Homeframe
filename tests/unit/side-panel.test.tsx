import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell, AppViewport, HomeframeProvider, SidePanel } from '@builtbyted/react';

let width = 1400;
const observers = new Set<() => void>();
beforeEach(() => {
  width = 1400;
  observers.clear();
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
  vi.stubGlobal('ResizeObserver', class {
    constructor(private notify: () => void) {}
    observe() { observers.add(this.notify); }
    disconnect() { observers.delete(this.notify); }
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function Harness({ side = 'right', manual = false }: { side?: 'left' | 'right'; manual?: boolean }) {
  const [open, setOpen] = useState(false);
  return <HomeframeProvider config={{ serviceWorker: false }}><AppViewport>
    <AppShell manualComposition={manual}
      sidePanel={<SidePanel open={open} onOpenChange={setOpen} side={side} aria-label="Tools"
        header={<h2>Tools</h2>} footer={<input aria-label="Draft" />}>
        <button type="button">Panel action</button>
      </SidePanel>}>
      <button type="button" onClick={() => setOpen(true)}>Open tools</button>
      <input aria-label="Application state" />
    </AppShell>
  </AppViewport></HomeframeProvider>;
}

function resize(next: number) {
  act(() => { width = next; for (const notify of observers) notify(); });
}

describe('SidePanel', () => {
  it.each(['left', 'right'] as const)('keeps shell, draft and scroll identity while opening from the %s', async (side) => {
    const { container } = render(<Harness side={side} />);
    const shell = container.querySelector('[data-hf-shell]');
    const panel = container.querySelector<HTMLElement>('[data-hf-side-panel]')!;
    expect(panel).toHaveAttribute('inert');
    expect(screen.queryByRole('complementary')).toBeNull();
    fireEvent.click(screen.getByText('Open tools'));
    expect(screen.getByRole('complementary', { name: 'Tools' })).toBe(panel);
    expect(panel.parentElement).toHaveAttribute('data-hf-side-panel-side', side);
    expect(panel.parentElement).toHaveAttribute('data-hf-side-panel-presentation', 'push');
    expect(panel).not.toHaveAttribute('aria-modal');
    fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'Keep me' } });
    const content = panel.querySelector('[data-hf-side-panel-content]')!;
    content.scrollTop = 125;
    await waitFor(() => expect(panel).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));
    fireEvent.click(screen.getByText('Open tools'));
    expect(screen.getByLabelText('Draft')).toHaveValue('Keep me');
    expect(content.scrollTop).toBe(125);
    expect(container.querySelector('[data-hf-shell]')).toBe(shell);
    expect(container.querySelector('[data-hf-side-panel]')).toBe(panel);
  });

  it('switches presentation on resize and confines keyboard focus only while covering the app', async () => {
    const { container, unmount } = render(<Harness />);
    const trigger = screen.getByText('Open tools');
    trigger.focus();
    fireEvent.click(trigger);
    const panel = screen.getByRole('complementary');
    await waitFor(() => expect(panel).toHaveFocus());
    resize(1000);
    expect(screen.getByRole('dialog')).toBe(panel);
    expect(panel).toHaveAttribute('aria-modal', 'true');
    expect(panel.parentElement).toHaveAttribute('data-hf-side-panel-presentation', 'overlay');
    const app = container.querySelector<HTMLElement>('[data-hf-side-panel-app]')!;
    expect(app.inert).toBe(true);
    expect(document.documentElement.dataset.hfModal).toBe('open');
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Close panel' })).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(screen.getByLabelText('Draft')).toHaveFocus();
    resize(390);
    expect(panel.parentElement).toHaveAttribute('data-hf-side-panel-presentation', 'fullscreen');
    resize(1400);
    expect(panel).not.toHaveAttribute('aria-modal');
    expect(app.inert).toBeFalsy();
    expect(document.documentElement.dataset.hfModal).toBeUndefined();
    resize(390);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(panel).toHaveAttribute('inert');
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(app.inert).toBeFalsy();
    fireEvent.click(trigger);
    unmount();
    expect(document.documentElement.dataset.hfModal).toBeUndefined();
  });

  it('dismisses from the backdrop in a manually composed shell', () => {
    width = 1000;
    const { container } = render(<Harness manual />);
    fireEvent.click(screen.getByText('Open tools'));
    fireEvent.click(container.querySelector('[data-hf-side-panel-backdrop]')!);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(container.querySelector('[data-hf-shell]')).toHaveAttribute('data-hf-manual-composition');
  });
});
