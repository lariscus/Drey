import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect, type Page } from './fixtures/drey';

/**
 * The Persona page (board 7k, milestone 201) in the running app: opened
 * from a Crew card (req-295), read from the persona's files in the
 * vault, saved as one commit through `personaPatch`. A home of its own, so
 * the plugin spawns an engine for the seeded vault and never adopts the
 * owner's.
 */
const engineHome = fs.mkdtempSync(path.join(os.tmpdir(), 'drey-e2e-home-'));
process.env['USERPROFILE'] = engineHome;
process.env['HOME'] = engineHome;

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

const persona = (title: string, role: string, summary = ''): string =>
  ['---', `title: ${title}`, `role: ${role}`, ...(summary === '' ? [] : [`summary: "${summary}"`]), 'worker: opencode', 'models:', '  default: qwen3-coder', '  pool: [qwen3-coder]', '  router: off', "color: '#8ecbef'", 'skills: [tdd]', 'budget: 5', '---', `Who ${title} is.`, ''].join('\n');

test.use({
  seedVault: {
    'tickets/_meta/pipeline.md': ['---', 'phases:', '  - { id: inbox, title: Inbox, handover: manual }', '  - { id: build, title: Build, handover: agent build-default, persona: ben }', '  - { id: done, title: Done, handover: none }', '---', 'The phases.', ''].join('\n'),
    'tickets/_meta/repos.md': ['---', 'repos:', '  drey:', '    url: https://example.invalid/drey.git', '    branch: main', '---', ''].join('\n'),
    'tickets/_meta/personas/ben/persona.md': persona('Ben', 'builder', 'Builds one part, test first.'),
    'tickets/_meta/personas/ben/prompt.md': 'You are Ben.\n',
    'tickets/_meta/personas/ben/improvements.md': ['# Improvements — ben', '', '- imp-1 open prompt.md — Add a line about the ADR index', "  - proposed: '2026-11-02T10:00:00Z'", '  - evidence:', '    - 2026-11-01 · T-0007 · guessed a convention', '  - content:', '      You are Ben, who reads the ADR index.', ''].join('\n'),
    'tickets/_meta/personas/ralf/persona.md': persona('Ralf', 'reviewer'),
    'tickets/10-inbox/T-0001.md': ['---', 'id: T-0001', 'title: "A seeded ticket"', 'repo: drey', 'priority: normal', 'branch: t/T-0001', "entered-inbox: '2026-10-20T09:00:00Z'", '---', '', '## Description', '', 'Text.', '', '## Log', ''].join('\n'),
  },
  appConfig: { plugins: { disabled: ['sample', 'templates', 'browser', 'drawio', 'ocr', 'meeting'] }, spellcheck: { enabled: false } },
});

test.beforeEach(({ vaultDir }) => {
  execFileSync('git', ['init', '-q'], { cwd: vaultDir, windowsHide: true });
  // Ralf's prompt.md cannot be read: a directory stands where the file belongs.
  fs.mkdirSync(path.join(vaultDir, 'tickets', '_meta', 'personas', 'ralf', 'prompt.md'), { recursive: true });
});

/** req-288: the engine's start moves the v2 records onto class and model; the page is opened once that commit is in. */
async function migrated(vaultDir: string): Promise<void> {
  await expect
    .poll(() => {
      try {
        return execFileSync('git', ['log', '--format=%s'], { cwd: vaultDir, encoding: 'utf8', windowsHide: true });
      } catch {
        return '';
      }
    }, { timeout: 30_000 })
    .toContain('personas: class and model replace worker and models (req-288)');
}

async function openPersona(page: Page, id: string): Promise<void> {
  await expect(page.locator('app-titlebar [role="tab"]', { hasText: 'Work' })).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('Control+2');
  await page.locator('app-panel-frame', { has: page.locator('.tickets-panel') }).filter({ visible: true }).locator('.head').hover();
  await page.locator('button[aria-label="More actions"]:visible').click({ force: true });
  await page.getByRole('menuitem', { name: 'Crew', exact: true }).click();
  await page.locator(`.desk-team [data-persona="${id}"]`).first().click();
  await expect(page.locator('.persona-page .persona-ed-view .cm-content').filter({ visible: true })).toBeVisible({ timeout: 15_000 });
}

test('edit, discard and save a persona as one commit', async ({ page, vaultDir }) => {
  test.setTimeout(120_000);
  await expect(page.locator('app-titlebar [role="tab"]', { hasText: 'Work' })).toBeVisible({ timeout: 30_000 });
  await migrated(vaultDir);
  await openPersona(page, 'ben');
  const dir = path.join(vaultDir, 'tickets', '_meta', 'personas', 'ben');
  const body = page.locator('.persona-page').filter({ visible: true });
  const editor = body.locator('.persona-ed-view .cm-content');
  const state = body.locator('.persona-head .persona-state');

  await expect(page.locator('app-tab-bar .tab', { hasText: 'Ben · persona' })).toBeVisible();
  await expect(editor).toContainText('You are Ben.');
  await expect(body.locator('.persona-head-name')).toHaveText('Ben');
  await expect(body.locator('[data-field="role"]')).toHaveValue('Builder');
  await expect(body.locator('[data-field="summary"]')).toHaveValue('Builds one part, test first.');
  // req-258: no step chips; the run settings, the builder's read-only off by its role.
  await expect(body.locator('.persona-step')).toHaveCount(0);
  await expect(body.locator('[data-field="readonly"]')).toHaveAttribute('aria-checked', 'false');
  await expect(state).toContainText('Saved');
  // req-288: the start moved the v2 record onto class and model, once — the pool held one model, so it is pinned.
  await expect.poll(() => fs.readFileSync(path.join(dir, 'persona.md'), 'utf8'), { timeout: 15_000 }).toContain('class: heavy');
  expect(fs.readFileSync(path.join(dir, 'persona.md'), 'utf8')).toContain('model: "opencode/qwen3-coder"');
  expect(fs.readFileSync(path.join(dir, 'persona.md'), 'utf8')).not.toMatch(/^(worker|models):/m);
  expect(execFileSync('git', ['log', '--format=%s'], { cwd: vaultDir, encoding: 'utf8', windowsHide: true })).toContain('personas: class and model replace worker and models (req-288)');
  await expect(body.locator('.persona-seg-btn[aria-checked="true"]')).toHaveText('heavy');
  await expect(body.locator('[data-field="pinned-model"]')).toContainText('qwen3-coder');
  for (const gone of ['[data-field="worker"]', '[data-field="min-class"]', '.persona-pool-row']) {
    await expect(body.locator(gone)).toHaveCount(0);
  }
  // The prose of persona.md moved into prompt.md when the engine started: one logged commit, once.
  expect(fs.readFileSync(path.join(dir, 'prompt.md'), 'utf8')).toContain('## Who Ben is');
  expect(fs.readFileSync(path.join(dir, 'persona.md'), 'utf8')).not.toContain('Who Ben is');
  for (const absent of ['Open as Markdown', 'Tell me when', 'Plain Markdown', 'Harness', 'Class floor']) {
    await expect(body).not.toContainText(absent);
  }

  // The draft survives leaving the tab; Discard returns to the file.
  await editor.fill('A draft');
  await expect(state).toHaveText('Changed · not saved');
  await page.locator('app-tab-bar .tab', { hasText: 'Crew' }).first().click();
  await page.locator('app-tab-bar .tab', { hasText: 'Ben · persona' }).click();
  await expect(page.locator('.persona-page .persona-ed-view .cm-content').filter({ visible: true })).toContainText('A draft');
  await body.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(editor).toContainText('You are Ben.');
  expect(fs.readFileSync(path.join(dir, 'prompt.md'), 'utf8')).toContain('You are Ben.');

  // Save: both files in one commit, the tab follows the new name.
  const before = Number(execFileSync('git', ['rev-list', '--count', '--all'], { cwd: vaultDir, encoding: 'utf8', windowsHide: true }).trim());
  await body.locator('[data-field="title"]').fill('Benno');
  await body.locator('[data-field="summary"]').fill('Builds the part.');
  await editor.fill('You are Benno.');
  await body.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(state).toContainText('Saved', { timeout: 15_000 });
  await expect(page.locator('app-tab-bar .tab', { hasText: 'Benno · persona' })).toBeVisible();
  expect(fs.readFileSync(path.join(dir, 'prompt.md'), 'utf8')).toBe('You are Benno.');
  expect(fs.readFileSync(path.join(dir, 'persona.md'), 'utf8')).toContain('title: Benno');
  expect(fs.readFileSync(path.join(dir, 'persona.md'), 'utf8')).toContain('summary: "Builds the part."');
  expect(execFileSync('git', ['log', '-1', '--format=%s'], { cwd: vaultDir, encoding: 'utf8', windowsHide: true }).trim()).toBe('personas: ben updated');
  expect(execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: vaultDir, encoding: 'utf8', windowsHide: true })).toContain('prompt.md');
  expect(Number(execFileSync('git', ['rev-list', '--count', '--all'], { cwd: vaultDir, encoding: 'utf8', windowsHide: true }).trim())).toBe(before + 1);

  // Allowed to: a switch is part of the same Save.
  await body.locator('[data-field="network"]').click();
  await body.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(state).toContainText('Saved', { timeout: 15_000 });
  expect(fs.readFileSync(path.join(dir, 'persona.md'), 'utf8')).toContain('allowed:\n  network: true');

  // req-258/288: the class and the run settings ride the same Save into persona.md; a class change drops a pin outside the class.
  await body.locator('.persona-seg-btn[data-value="standard"]').click();
  await expect(body.locator('[data-field="pinned-model"]')).toHaveText('Next free in class');
  await body.locator('[data-field="readonly"]').click();
  await body.locator('[data-field="parallel"]').fill('2');
  await body.getByRole('button', { name: 'Add action…', exact: true }).click();
  await body.locator('.persona-actions select').selectOption('sync-main');
  await body.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(state).toContainText('Saved', { timeout: 15_000 });
  const settings = fs.readFileSync(path.join(dir, 'persona.md'), 'utf8');
  for (const line of ['class: standard', 'parallel: 2', 'leaving: [sync-main]', 'readonly: true']) {
    expect(settings).toContain(line);
  }
  expect(settings).not.toMatch(/^(model|min-class):/m);

  // The Proposals card: Dismiss is written to the proposals file.
  await expect(body.locator('[data-proposal]')).toContainText('Add a line about the ADR index');
  await body.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(body.locator('[data-proposal]')).toHaveCount(0, { timeout: 15_000 });
  expect(fs.readFileSync(path.join(dir, 'improvements.md'), 'utf8')).toContain('imp-1 dismissed');

  // Back to Crew.
  await body.getByRole('button', { name: 'Back to Crew', exact: true }).click();
  await expect(page.locator('.desk-team').filter({ visible: true })).toBeVisible();
});

test('a prompt that cannot be read leaves the editor and Save disabled', async ({ page }) => {
  test.setTimeout(120_000);
  await openPersona(page, 'ralf');
  const body = page.locator('.persona-page').filter({ visible: true });
  await expect(body.locator('.persona-ed-view .cm-content')).toHaveAttribute('contenteditable', 'false');
  await expect(body.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await expect(body.locator('.persona-head .persona-state')).toContainText('Could not read the instructions');
});

/** A 2 × 1 PNG: wider than tall, so the page crops it to a square before it sends it. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGP4z8AAQv8BD/kD/YURmXYAAAAASUVORK5CYII=', 'base64');

test('req-288: the picture is uploaded and removed from the Profile block, one commit each', async ({ page, vaultDir }) => {
  test.setTimeout(120_000);
  await openPersona(page, 'ben');
  const body = page.locator('.persona-page').filter({ visible: true });
  const avatar = path.join(vaultDir, 'tickets', '_meta', 'personas', 'ben', 'avatar.png');
  const subjects = (): string => execFileSync('git', ['log', '--format=%s'], { cwd: vaultDir, encoding: 'utf8', windowsHide: true });
  await body.getByRole('button', { name: 'Change picture', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await body.getByRole('menuitem', { name: 'Upload picture…' }).click();
  await (await chooser).setFiles({ name: 'ben.png', mimeType: 'image/png', buffer: PNG });
  await expect.poll(subjects, { timeout: 15_000 }).toContain('personas: ben picture');
  const written = fs.readFileSync(avatar);
  expect(written.subarray(1, 4).toString('ascii')).toBe('PNG');
  expect(written.readUInt32BE(16)).toBe(256); // the page drew a 256 × 256 square
  expect(written.readUInt32BE(20)).toBe(256);
  await expect(body.locator('.persona-avatar-profile img.persona-picture')).toBeVisible({ timeout: 15_000 });

  await body.getByRole('button', { name: 'Change picture', exact: true }).click();
  await body.getByRole('menuitem', { name: 'Remove picture' }).click();
  await expect.poll(subjects, { timeout: 15_000 }).toContain('personas: ben picture removed');
  expect(fs.existsSync(avatar)).toBe(false);
  // Ben's picture is a shipped one: its id is in seeded-pictures, so the engine's backfill leaves it removed.
  expect(fs.readFileSync(path.join(vaultDir, 'tickets', '_meta', 'crew.md'), 'utf8')).toMatch(/seeded-pictures:.*\bben\b/);
  await expect(body.locator('.persona-avatar-profile img.persona-picture')).toHaveCount(0, { timeout: 15_000 });
});

test('req-288: a pinned model is saved as the record\'s model; Next free in class clears it', async ({ page, vaultDir }) => {
  test.setTimeout(120_000);
  await expect(page.locator('app-titlebar [role="tab"]', { hasText: 'Work' })).toBeVisible({ timeout: 30_000 });
  await migrated(vaultDir);
  await openPersona(page, 'ben');
  const body = page.locator('.persona-page').filter({ visible: true });
  const file = path.join(vaultDir, 'tickets', '_meta', 'personas', 'ben', 'persona.md');
  await expect.poll(() => fs.readFileSync(file, 'utf8'), { timeout: 15_000 }).toContain('model: "opencode/qwen3-coder"');
  await body.locator('[data-field="pinned-model"]').click();
  await body.locator('.persona-listbox [role="option"]', { hasText: 'Next free in class' }).click();
  await body.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(body.locator('.persona-head .persona-state')).toContainText('Saved', { timeout: 15_000 });
  await expect.poll(() => fs.readFileSync(file, 'utf8'), { timeout: 15_000 }).not.toContain('model:');
  expect(fs.readFileSync(file, 'utf8')).toContain('class: heavy');
});
