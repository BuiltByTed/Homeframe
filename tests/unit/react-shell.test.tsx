import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  AppScrollView,
  AppShell,
  AppViewport,
  HomeframeInput,
  HomeframeProvider,
  SelectableText,
} from '@homeframe/react';

describe('React shell primitives', () => {
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

  it('enforces editable text sizing and marks intentional selection', () => {
    const { container } = render(
      <HomeframeProvider config={{ serviceWorker: false }}>
        <AppViewport>
          <HomeframeInput aria-label="Name" style={{ color: 'red' }} />
          <SelectableText>Copy me</SelectableText>
        </AppViewport>
      </HomeframeProvider>,
    );
    const inlineStyle = screen.getByLabelText('Name').getAttribute('style') ?? '';
    expect(inlineStyle).toContain('font-size: max(var(--hf-input-min-font-size, 16px), 1rem)');
    expect(inlineStyle).toContain('color: red');
    expect(container.querySelector('[data-hf-selectable]')).toHaveTextContent('Copy me');
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
});
