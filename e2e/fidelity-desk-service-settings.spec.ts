import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, expect, type ElectronApplication, type Page } from './fixtures/drey';

/**
 * NOT a regression suite: puts the built app in the state of board 8c
 * (DeskServiceSettings, Settings → Background service) and takes the
 * screenshot the fidelity checklist asks for. Opt-in, so CI skips it:
 *
 *   . .\env.ps1
 *   $env:DREY_FIDELITY_SHOTS = '1'
 *   npm run e2e:run -- fidelity-desk-service-settings
 *
 * Output: `test-results/fidelity/DeskServiceSettings.png` (1440x900, scale
 * factor 1), `.below` (the page scrolled to Load and Logs, which the board
 * clips) and `.rects.json` (measures of the page's items).
 *
 * The Windows `Run` key is the owner's real registry: this spec never
 * stores `service.autostart` (the checkbox is ticked in the DOM only, for
 * the picture).
 */

const RUN = !!process.env['DREY_FIDELITY_SHOTS'];
test.skip(!RUN, 'set DREY_FIDELITY_SHOTS=1 -- the screenshot of board 8c');

const engineHome = fs.mkdtempSync(path.join(os.tmpdir(), 'drey-e2e-home-'));
process.env['USERPROFILE'] = engineHome;
process.env['HOME'] = engineHome;

interface ServiceLockFile {
  readonly pid?: number;
  readonly port?: number;
  readonly token?: string;
}

function readLock(): ServiceLockFile | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(engineHome, '.drey-engine', 'service.lock'), 'utf8')) as ServiceLockFile;
  } catch {
    return null;
  }
}

function stopEngine(): void {
  const pid = readLock()?.pid;
  if (typeof pid === 'number') {
    try {
      process.kill(pid);
    } catch {
      // already gone
    }
  }
}

test.afterAll(() => {
  stopEngine();
  fs.rmSync(engineHome, { recursive: true, force: true });
});

const OUT = path.resolve(__dirname, '..', 'test-results', 'fidelity');
const WIDTH = 1440;
const HEIGHT = 900;

const PIPELINE = [
  '---',
  'phases:',
  '  - { id: inbox, title: Inbox, handover: manual }',
  '  - { id: build, title: Building, handover: agent build-default, persona: ben }',
  '  - { id: done, title: Done, handover: none }',
  '---',
  'The phases.',
  '',
].join('\n');

const REPOS = ['---', 'repos:', '  drey:', '    url: https://example.invalid/drey.git', '    branch: main', '---', ''].join('\n');

function persona(title: string, role: string, color: string, budget: number): string {
  return ['---', `title: ${title}`, `role: ${role}`, 'worker: opencode', 'models:', '  default: qwen3-coder', '  pool: [qwen3-coder]', '  router: off', `color: '${color}'`, 'skills: []', `budget: ${budget}`, '---', `Who ${title} is.`, ''].join('\n');
}

function ticket(id: string, title: string): string {
  return [
    '---',
    `id: ${id}`,
    `title: "${title}"`,
    'repo: drey',
    'priority: normal',
    `branch: t/${id}`,
    "entered-inbox: '2026-10-20T09:00:00Z'",
    "entered-build: '2026-10-30T09:00:00Z'",
    '---',
    '',
    '## Description',
    '',
    `${title} - what the owner wants.`,
    '',
    '## Log',
    '',
  ].join('\n');
}

const seed: Record<string, string> = {
  'tickets/_meta/pipeline.md': PIPELINE,
  'tickets/_meta/repos.md': REPOS,
  'tickets/_meta/personas/paul/persona.md': persona('Paul', 'planner', '#f2d3e2', 3),
  'tickets/_meta/personas/ben/persona.md': persona('Ben', 'builder', '#8ecbef', 15),
  'tickets/40-build/T-0017.md': ticket('T-0017', 'A8 large modules'),
  'projects/Notes.md': '# Notes\n\n412 words of nothing in particular.\n',
};

async function sizeWindow(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.webContents.getURL().startsWith('app://')) {
        win.setContentSize(size.width, size.height);
      }
    }
  }, { width: WIDTH, height: HEIGHT });
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

/** Wakes the Crew runner through the service's control port, as Start does, so its row reads running with Restart and Stop. */
async function wakeRunner(): Promise<void> {
  const lock = readLock();
  if (lock?.port === undefined || lock.token === undefined) {
    return;
  }
  await fetch(`http://127.0.0.1:${lock.port}/components/runner/start`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${lock.token}`, 'content-type': 'application/json' },
    body: '{}',
  }).catch(() => undefined);
}

test.use({
  seedVault: seed,
  launchArgs: ['--force-device-scale-factor=1'],
  appConfig: {
    plugins: { disabled: ['sample', 'templates', 'browser', 'drawio', 'ocr', 'meeting'] },
    spellcheck: { enabled: false },
    mcp: { enabled: true, httpEnabled: true, httpPort: 4319 },
    llm: { enabled: true, provider: 'openai-compat', baseUrl: 'http://127.0.0.1:9/v1', apiKey: null, model: 'glm-5.3-flash' },
  },
});

test('board 8c: Settings → Background service', async ({ page, electronApp }) => {
  test.setTimeout(240_000);
  fs.mkdirSync(OUT, { recursive: true });
  await sizeWindow(electronApp);
  await expect(page.locator('app-titlebar [role="tab"]', { hasText: 'Work' })).toBeVisible({ timeout: 30_000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.keyboard.press('Control+2');
  await page.waitForTimeout(500);
  // The board draws no side panel: every panel in the left dock, the right dock empty, both docks folded.
  await page.evaluate(() => {
    const ids = [...document.querySelectorAll<HTMLElement>('app-dock-strip button[data-widget]')].map((b) => b.dataset['widget'] ?? '');
    const saved = JSON.parse(localStorage.getItem('drey.dock') ?? '{}') as { active: string; views: Record<string, Record<string, unknown>> };
    const view = saved.views[saved.active];
    saved.views[saved.active] = {
      ...view,
      dock: { left: ids, right: [], bottom: (view['dock'] as { bottom: string[] }).bottom },
      bottomH: 140,
      open: Object.fromEntries(ids.map((id) => [id, false])),
      foldedSides: ['left', 'right'],
    };
    localStorage.setItem('drey.dock', JSON.stringify(saved));
  });
  await page.reload();
  await sizeWindow(electronApp);
  await expect(page.locator('app-titlebar [role="tab"]', { hasText: 'Work' })).toBeVisible({ timeout: 30_000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.keyboard.press('Control+p');
  await page.locator('.palette input').fill('T-0017');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);

  // The service the page reads: wait for the one the plugin starts, wake its runner, store the board's values.
  await expect.poll(() => readLock()?.port, { timeout: 90_000 }).toBeDefined();
  await wakeRunner();
  await page.evaluate(async () => {
    await window.dreyApi.invokePlugin('tickets', 'serviceSettingsSet', {
      enabled: true,
      heavySeats: 2,
      reserve: 25,
      lowPriority: true,
      quietHours: '22:00 – 07:00',
    });
  });

  await page.locator('app-status-bar .settings').click();
  await expect(page.locator('app-settings .category').first()).toBeVisible();
  await page.locator('app-settings .category', { hasText: 'Background service' }).first().click();
  await expect(page.locator('app-settings-background-service')).toBeVisible();
  await expect(page.locator('[data-setting-key="service.component.runner"] button', { hasText: 'Restart' })).toBeVisible({ timeout: 30_000 });
  // Start with Windows is ticked in the DOM only: storing it would write the owner's real Windows Run key.
  await page.locator('[data-setting-key="service.autostart"] input').evaluate((el: HTMLInputElement) => {
    el.disabled = false;
    el.checked = true;
  });
  await shoot(page, 'DeskServiceSettings');

  const rects = await page.evaluate(() => {
    const out: Record<string, number[]> = {};
    const rect = (el: Element): number[] => {
      const r = el.getBoundingClientRect();
      return [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 10) / 10);
    };
    const q = (selector: string): Element | null => document.querySelector(selector);
    document.querySelectorAll('app-settings-background-service section h3').forEach((h, i) => (out[`h3-${i}`] = rect(h)));
    const title = q('app-settings-background-service .pane-head h2');
    if (title !== null) {
      out['h1'] = rect(title);
    }
    document.querySelectorAll('app-settings-background-service [data-setting-key]').forEach((el) => {
      const key = el.getAttribute('data-setting-key') ?? '';
      out[`item:${key}`] = rect(el);
      el.querySelectorAll('input, button').forEach((c, j) => (out[`item:${key}:ctl${j}:${c.getAttribute('aria-label') ?? c.textContent?.trim() ?? ''}`] = rect(c)));
    });
    return out;
  });
  fs.writeFileSync(path.join(OUT, 'DeskServiceSettings.rects.json'), JSON.stringify(rects, null, 1));

  // The part the board clips: Load and Logs.
  await page.locator('[data-setting-key="service.logs.folder"]').scrollIntoViewIfNeeded();
  await shoot(page, 'DeskServiceSettings.below');
});
