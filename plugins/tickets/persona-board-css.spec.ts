// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * What only the stylesheet decides about the persona board's columns,
 * against the real `renderer/desk.css`. Beside the renderer: its specs may
 * not read files (lint). jsdom lays nothing out, so the e2e
 * `view-default-layouts` measures the scroll in the running app.
 */
describe('the persona board keeps its column width and scrolls sideways (board 7q, req-297)', () => {
  const css = readFileSync(path.join(__dirname, 'renderer', 'desk.css'), 'utf8');

  beforeAll(() => {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
  });

  it('a persona column grows into spare room (7e v2) but never shrinks below 158 px (7q)', () => {
    const lane = document.createElement('div');
    lane.className = 'pb-col pb-col-lane';
    document.body.append(lane);
    const style = getComputedStyle(lane);
    expect(style.flexGrow).toBe('1');
    expect(style.flexShrink).toBe('0');
    expect(style.flexBasis).toBe('158px');
    expect(style.minWidth).toBe('158px');
  });

  it('the row of columns scrolls sideways instead of squeezing them', () => {
    const cols = document.createElement('div');
    cols.className = 'pb-cols';
    document.body.append(cols);
    expect(getComputedStyle(cols).overflowX).toBe('auto');
  });

  it('Inbox, Prioritized and Done keep their fixed widths', () => {
    expect(css).toMatch(/\.pb-col-edge\s*\{[^}]*flex:\s*0 0 140px/);
    expect(css).toMatch(/\.pb-col-done\s*\{[^}]*flex:\s*0 0 172px/);
  });
});
