import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = await readFile(resolve(process.cwd(), 'packages/runtime/src/styles.css'), 'utf8');

describe('runtime structural CSS', () => {
  it('adds keyboard-height trailing range to content scroll views', () => {
    expect(styles).toMatch(/\[data-hf-keyboard-target='content'\]\s+\[data-hf-scroll-view\]::after\s*\{[^}]*height:\s*var\(--hf-keyboard-height\)/s);
  });

  it('stops edge navigation guards above the measured and translated dock', () => {
    expect(styles).toMatch(/\[data-hf-edge-guard\]\s*\{[^}]*bottom:\s*calc\(var\(--hf-bottom-height\) \+ var\(--hf-dock-keyboard-offset\)\)/s);
  });

  it('keeps dock placement independent from keyboard avoidance', () => {
    expect(styles).toMatch(/\[data-hf-dock\]:is\([^)]*\[data-hf-dock-placement='overlay'\][^)]*\)[^{]*\{[^}]*position:\s*fixed/s);
    expect(styles).toMatch(/\[data-hf-dock\]\[data-keyboard-policy='avoid'\]\s*\{[^}]*var\(--hf-dock-keyboard-offset\)/s);
  });
});
