import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect, type ElectronApplication, type Page } from './fixtures/drey';

/**
 * req-281 with req-293 – req-296 in the running app, on the real engine: the
 * Crew tab draws the cards alone (board 7f v2, `DeskTeamV2`), Pia's card
 * first; a click on a card opens the persona's page (req-295) — Pia's with
 * Profile, Model, Skills and the tabs Instructions · Memory · 1:1 (7k v4
 * `DeskPersonaPia`), Ben's with state, cost and Pause in its head and the
 * same tabs (7k v4 `DeskPersonaV4`). Pia's model choice is saved into her
 * `persona.md` as `model:`. A home of its own, so the plugin spawns an engine
 * for the seeded vault and never adopts the owner's. The screenshots go to
 * test-results/fidelity/<Board>-built.png for boards/compare.html.
 */
const engineHome = fs.mkdtempSync(path.join(os.tmpdir(), 'drey-e2e-home-'));
process.env['USERPROFILE'] = engineHome;
process.env['HOME'] = engineHome;

const OUT = path.resolve(__dirname, '..', 'test-results', 'fidelity');

test.afterAll(() => {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(engineHome, '.drey-engine', 'service.lock'), 'utf8')) as { pid?: number };
    if (typeof lock.pid === 'number') {
      process.kill(lock.pid);
    }
  } catch {
    // no engine was started, or it is already gone
  }
  fs.rmSync(engineHome, { recursive: true, force: true });
});

test.use({
  seedVault: {
    'tickets/_meta/pipeline.md': ['---', 'phases:', '  - { id: inbox, title: Inbox, handover: manual }', '  - { id: build, title: Build, handover: agent build-default }', '  - { id: done, title: Done, handover: none }', '---', 'The phases.', ''].join('\n'),
    'tickets/_meta/repos.md': ['---', 'repos:', '  drey:', '    url: https://example.invalid/drey.git', '    branch: main', '---', ''].join('\n'),
    'tickets/_meta/personas/ben/persona.md': ['---', 'title: Ben', 'role: builder', 'worker: opencode', 'models:', '  default: qwen3-coder', '  pool: [qwen3-coder]', "color: '#bfdbf7'", 'skills: []', 'budget: 5', '---', ''].join('\n'),
    'tickets/_meta/personas/ben/prompt.md': '## Who Ben is\n\nBen builds.\n',
    'tickets/10-inbox/T-0001.md': ['---', 'id: T-0001', 'title: "A seeded ticket"', 'repo: drey', 'priority: normal', 'branch: t/T-0001', "entered-inbox: '2026-10-20T09:00:00Z'", '---', '', '## Description', '', 'Text.', '', '## Log', ''].join('\n'),
  },
  appConfig: {
    plugins: { disabled: ['sample', 'templates', 'browser', 'drawio', 'ocr', 'meeting'] },
    spellcheck: { enabled: false },
    // The assistant's connection: an LM Studio endpoint nobody answers at — the provider is named, the model list is empty.
    llm: { enabled: true, provider: 'lmstudio', baseUrl: 'http://127.0.0.1:9/v1', apiKey: null, model: 'qwen3-coder-30b' },
  },
});

test.beforeEach(({ vaultDir }) => {
  execFileSync('git', ['init', '-q'], { cwd: vaultDir, windowsHide: true });
});

const subjects = (vaultDir: string): readonly string[] => {
  try {
    return execFileSync('git', ['log', '--format=%s'], { cwd: vaultDir, encoding: 'utf8', windowsHide: true }).trim().split('\n');
  } catch {
    return [];
  }
};

async function sizeWindow(app: ElectronApplication, height: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, h) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.webContents.getURL().startsWith('app://')) {
        win.setContentSize(1440, h);
      }
    }
  }, height);
}

async function openCrew(page: Page): Promise<void> {
  await expect(page.locator('app-titlebar [role="tab"]', { hasText: 'Work' })).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('Control+2');
  await page.locator('app-panel-frame', { has: page.locator('.tickets-panel') }).filter({ visible: true }).locator('.head').hover();
  await page.locator('button[aria-label="More actions"]:visible').click({ force: true });
  await page.getByRole('menuitem', { name: 'Crew', exact: true }).click();
}

const shot = async (page: Page, board: string): Promise<void> => {
  await page.waitForTimeout(400);
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${board}-built.png`) });
};

test('Pia on the Crew tab and her page; a card opens the Persona page with its tabs', async ({ page, vaultDir, electronApp }) => {
  test.setTimeout(180_000);
  await expect
    .poll(() => subjects(vaultDir).includes('personas: the default crew (req-256)'), { message: 'the engine has seeded the crew', timeout: 60_000 })
    .toBe(true);
  await sizeWindow(electronApp, 900);
  await openCrew(page);
  // The boards draw the right dock folded (7f, 7k): fold it, so five cards stand in one row as on 7f v2.
  await page.keyboard.press('Control+Alt+B');

  // 7f v2: the cards alone, Pia first — idle, her one line; no detail pane.
  const team = page.locator('.desk-team').filter({ visible: true });
  await expect(team).toBeVisible({ timeout: 15_000 });
  const ids = (): Promise<string[]> => team.locator('.desk-persona').evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset['persona'] ?? ''));
  await expect.poll(ids, { timeout: 20_000 }).toEqual(['pia', 'paul', 'ben', 'ralf', 'tessa']);
  const pia = team.locator('[data-persona="pia"]');
  await expect(pia.locator('.desk-persona-state')).toHaveText('idle');
  await expect(pia).toContainText("Mission Control: the owner's one contact");
  await expect(team.locator('.desk-detail, .desk-tabs')).toHaveCount(0);
  await expect(team.locator('.desk-head-sub')).toHaveText('4 personas');
  await shot(page, 'DeskTeamV2');

  // 7k v4 · Pia: Profile without Role, Model (the assistant's provider named), Skills, the three tabs; no Work.
  await pia.click();
  const body = page.locator('.persona-page').filter({ visible: true });
  await expect(body.locator('.persona-head-name')).toHaveText('Pia', { timeout: 20_000 });
  await expect(body.locator('.persona-head')).toContainText('Mission Control');
  await expect(body.locator('.persona-facts')).toContainText('idle');
  await expect(body.locator('button[aria-label^="Pause"]')).toHaveCount(0);
  const model = body.locator('section[aria-label="Model"]');
  await expect(model).toContainText('LM Studio', { timeout: 20_000 });
  const select = model.locator('select[data-field="chat-model"]');
  await expect(select).toHaveValue('');
  await expect(body.locator('section[aria-label="Skills"]').first()).toBeVisible();
  await expect(body.locator('.persona-tab')).toHaveText(['Instructions', 'Memory', '1:1']);
  await sizeWindow(electronApp, 1200);
  await shot(page, 'DeskPersonaPia');

  // req-293: Other model…, typed, saved as `model:` in her persona.md (one commit).
  await select.selectOption({ label: 'Other model…' });
  await model.locator('[data-field="chat-model-other"]').fill('glm-4.7-flash');
  await body.locator('.persona-save').click();
  const file = path.join(vaultDir, 'tickets', '_meta', 'personas', 'pia', 'persona.md');
  await expect.poll(() => fs.readFileSync(file, 'utf8'), { timeout: 20_000 }).toContain('model: "glm-4.7-flash"');

  // req-294: her 1:1 tab mounts the conversation pane (a line to her is no longer refused).
  await body.locator('.persona-tab', { hasText: '1:1' }).click();
  await expect(body.locator('.persona-pane')).toBeVisible();

  // 7k v4 · Ben: the page a card opens — state and Pause in the head, the same tabs.
  await sizeWindow(electronApp, 900);
  await openCrew(page);
  await team.locator('[data-persona="ben"]').click();
  await expect(body.locator('.persona-head-name')).toHaveText('Ben', { timeout: 20_000 });
  await expect(body.locator('.persona-facts')).toContainText('idle');
  await expect(body.locator('button[aria-label="Pause Ben"]')).toBeVisible();
  await body.locator('.persona-tab', { hasText: '1:1' }).click();
  await expect(body.locator('.persona-pane')).toBeVisible();
  await shot(page, 'DeskPersonaV4');
});
