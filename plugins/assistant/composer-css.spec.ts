import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** What only the stylesheet decides, against the real `renderer/assistant.css`. Beside the renderer: its specs may not read files (lint). */
describe('the assistant stylesheet', () => {
  const css = readFileSync(path.join(__dirname, 'renderer', 'assistant.css'), 'utf8');

  it('D-53: the composer\'s tool row is static -- no icon is hidden until the pointer is on its row (board 9a)', () => {
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, selector]) => selector!.includes('.assistant-composer'));
    const hiding = rules.filter(([, , body]) => /opacity:\s*0\s*(;|$)/.test(body!)).map(([, selector]) => selector!.trim());
    expect(hiding).toEqual([]);
    expect(css).not.toMatch(/\.composer-meta:(hover|focus-within)\s+\.prompt-btn/);
  });
});
