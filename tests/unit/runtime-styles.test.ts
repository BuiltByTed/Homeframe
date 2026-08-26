import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = await readFile(resolve(process.cwd(), 'packages/runtime/src/styles.css'), 'utf8');

describe('runtime structural CSS', () => {
  it('adds keyboard-height trailing range to content scroll views', () => {
    expect(styles).toMatch(/\[data-hf-keyboard-target='content'\]\s+\[data-hf-scroll-view\]::after\s*\{[^}]*height:\s*var\(--hf-keyboard-height\)/s);
  });

  it('can leave the app visible beneath the native keyboard without an occlusion mask', () => {
    expect(styles).toMatch(/data-hf-keyboard-occlusion='transparent'[^{}]*\[data-hf-shell\]::after\s*\{[^}]*display:\s*none/s);
  });

  it('stops edge navigation guards outside every measured viewport attachment', () => {
    expect(styles).toMatch(/\[data-hf-edge-guard\]\s*\{[^}]*top:\s*calc\(var\(--hf-header-height\) \+ var\(--hf-top-attachment-height\)\)/s);
    expect(styles).toMatch(/\[data-hf-edge-guard\]\s*\{[^}]*bottom:\s*calc\(var\(--hf-bottom-height\) \+ var\(--hf-bottom-attachment-height\) \+ var\(--hf-dock-keyboard-offset\)\)/s);
  });

  it('keeps dock placement independent from keyboard avoidance', () => {
    expect(styles).toMatch(/\[data-hf-dock\]:is\([^)]*\[data-hf-dock-placement='overlay'\][^)]*\)[^{]*\{[^}]*position:\s*fixed/s);
    expect(styles).toMatch(/:is\([^)]*\[data-hf-dock\][^)]*data-hf-attachment-anchor='dock'[^)]*\)\[data-keyboard-policy='avoid'\]\s*\{[^}]*var\(--hf-dock-keyboard-offset\)/s);
    expect(styles).toMatch(/data-hf-keyboard-motion='tracking'[\s\S]*data-keyboard-policy='avoid'[\s\S]*transition-duration:\s*0ms/);
    expect(styles).toMatch(/data-hf-header-overlay='true'[\s\S]*padding-top:\s*var\(--hf-header-height\)/);
  });

  it('positions measured viewport attachments without visual styling', () => {
    expect(styles).toMatch(/\[data-hf-viewport-attachment\]\s*\{[^}]*position:\s*absolute[^}]*right:\s*0[^}]*left:\s*0/s);
    expect(styles).toMatch(/data-hf-attachment-anchor='header'\]\s*\{[^}]*top:\s*var\(--hf-header-height\)/s);
    expect(styles).toMatch(/data-hf-attachment-anchor='dock'\]\s*\{[^}]*bottom:\s*var\(--hf-bottom-height\)/s);
  });

  it('keeps desktop attachments inside their owning content column', () => {
    expect(styles).toMatch(/@media \(min-width: 900px\)[\s\S]*data-hf-desktop-layout[^{}]*> \[data-hf-viewport-attachment\]\[data-hf-attachment-anchor='dock'\][^{]*\{[^}]*left:\s*var\(--hf-active-sidebar-width\)/s);
    expect(styles).toMatch(/data-hf-desktop-layout\]\[data-hf-header-placement='content'\][^{}]*> \[data-hf-viewport-attachment\]\[data-hf-attachment-anchor='header'\][^{]*\{[^}]*left:\s*var\(--hf-active-sidebar-width\)/s);
  });

  it('gives a dock attachment safe-bottom ownership only without a real dock', () => {
    expect(styles).toMatch(/\[data-hf-shell\]\[data-hf-has-dock='false'\][^{}]*> \[data-hf-viewport-attachment\]\[data-hf-attachment-anchor='dock'\][^{]*\{[^}]*padding-bottom:\s*var\(--hf-effective-safe-bottom\)/s);
  });

  it('removes a keyboard-covered manual dock from an avoiding attachment anchor', () => {
    expect(styles).toMatch(/data-hf-keyboard-target='dock'[^{}]*data-hf-bottom-keyboard-policy='manual'[^{}]*data-hf-attachment-anchor='dock'[^{}]*data-keyboard-policy='avoid'[^{}]*\{[^}]*bottom:\s*0/s);
  });

  it('places floating windows above chrome and promotes them to full-screen on mobile', () => {
    expect(styles).toMatch(/\[data-hf-viewport\]\s*\{[^}]*isolation:\s*isolate/s);
    expect(styles).toMatch(/\[data-hf-shell\]\s*\{[^}]*z-index:\s*0/s);
    expect(styles).toMatch(/\[data-hf-floating-window-layer\]\s*\{[^}]*z-index:\s*1200[^}]*inset:\s*0/s);
    expect(styles).toMatch(/@media \(max-width: 900px\)[\s\S]*data-hf-floating-mobile='fullscreen'[\s\S]*> \[data-hf-floating-window\][^{]*\{[^}]*width:\s*100%[^}]*height:\s*100%/s);
  });

  it('allows ordinary desktop selection without weakening compact touch surfaces', () => {
    expect(styles).not.toMatch(/\[data-hf-selection='allow-desktop'\]\s*\{[^}]*user-select:\s*none[^}]*\}\s*(?![\s\S]*@media)/s);
    expect(styles).toMatch(/@media \(max-width: 900px\)[\s\S]*\[data-hf-selection='allow-desktop'\]\s*\{[^}]*user-select:\s*none/s);
    expect(styles).toMatch(/\[data-hf-selection='allow-desktop'\] :is\([\s\S]*\[data-hf-selectable\][\s\S]*\)\s*\{[^}]*user-select:\s*text/s);
  });
});
