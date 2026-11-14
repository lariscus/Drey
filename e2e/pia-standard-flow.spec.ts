import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from './fixtures/drey';

// Drey Service is one process per user (`~/.drey-engine/service.lock`): a home
// of its own makes the plugin spawn an engine for the seeded vault and never
// adopt the owner's.
const engineHome = fs.mkdtempSync(path.join(os.tmpdir(), 'drey-e2e-home-'));
process.env['USERPROFILE'] = engineHome;
process.env['HOME'] = engineHome;

/**
 * req-306 on the real engine: Mission Control (Pia) in the Assistant panel
 * proposes the board's STANDARD FLOW as a card and knows the owner by name.
 * The owner's persona is `you` with the title "Henrik"; the mock model is an
 * OpenAI-compatible endpoint that proposes `setStandardFlow` only when the
 * turn's system message tells it that "Henrik", "me" and "I" are the persona
 * `you` (the `## Crew` block) — otherwise it answers the old refusal. The
 * confirm writes `flow:` in `_meta/pipeline.md`; the flow stays what it was
 * until then.
 */
const PORT = 41873;
const requests: { system: string; text: string }[] = [];

const REFUSAL = "Henrik isn't on the crew, and I can't change the default flow itself — chains can only be set per ticket.";
const AGREED = 'Paul shapes and plans, Ben builds, and you accept it — one card for the standard flow.';

function answerFor(system: string): string {
  const knowsOwner = system.includes('- you (Henrik): the owner, Henrik') && system.includes('"Henrik", "me", "I", "my" in the owner\'s words mean "you"');
  if (!system.includes('setStandardFlow') || !knowsOwner) {
    return JSON.stringify({ say: REFUSAL, thought: null, commands: [] });
  }
  return JSON.stringify({ say: AGREED, thought: null, commands: [{ kind: 'setStandardFlow', chain: ['paul:shape', 'ben', 'you'] }] });
}

const server = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    if (req.url?.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }));
      return;
    }
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
    } catch {
      // not JSON
    }
    const messages = (body['messages'] as { role: string; content: unknown }[] | undefined) ?? [];
    const system = messages.find((m) => m.role === 'system');
    const user = [...messages].reverse().find((m) => m.role === 'user');
    const systemText = typeof system?.content === 'string' ? system.content : '';
    requests.push({ system: systemText, text: typeof user?.content === 'string' ? user.content : '' });
    const text = answerFor(systemText);
    if (body['stream'] === true) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const chunk = (delta: Record<string, unknown>, finish: string | null): string =>
        `data: ${JSON.stringify({ id: 'mock-1', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
      res.write(chunk({ role: 'assistant', content: '' }, null));
      res.write(chunk({ content: text }, null));
      res.write(chunk({}, 'stop'));
      res.end('data: [DONE]\n\n');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'mock-1', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
  });
});

test.beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(PORT, '127.0.0.1', resolve));
});

function stopEngine(): void {
  try {
    const lock = JSON.parse(fs.readFileSync(path.join(engineHome, '.drey-engine', 'service.lock'), 'utf8')) as { pid?: number };
    if (typeof lock.pid === 'number') {
      process.kill(lock.pid);
    }
  } catch {
    // no engine was started, or it is already gone
  }
}

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  stopEngine();
  fs.rmSync(engineHome, { recursive: true, force: true });
});

const PIPELINE = ['---', 'phases:', '  - { id: inbox, title: Inbox, handover: manual }', '  - { id: done, title: Done, handover: none }', 'flow: paul:shape; ben; ralf; tessa; you', '---', 'The phases.', ''].join('\n');
const REPOS = ['---', 'repos:', '  drey:', '    url: https://example.invalid/drey.git', '    branch: main', '---', ''].join('\n');
const persona = (title: string, role: string, color: string): string =>
  ['---', `title: ${title}`, `role: ${role}`, 'worker: opencode', 'models:', '  default: mock-model', '  pool: [mock-model]', '  router: off', `color: '${color}'`, 'skills: []', 'budget: 3', '---', `Who ${title} is.`, ''].join('\n');

test.use({
  seedVault: {
    'tickets/_meta/pipeline.md': PIPELINE,
    'tickets/_meta/repos.md': REPOS,
    'tickets/_meta/personas/paul/persona.md': persona('Paul', 'planner', '#a78bfa'),
    'tickets/_meta/personas/ben/persona.md': persona('Ben', 'builder', '#3b82f6'),
    'tickets/_meta/personas/you/persona.md': ['---', 'title: Henrik', 'kind: human', 'role: custom', "color: '#e0bb6e'", '---', ''].join('\n'),
  },
  appConfig: {
    plugins: { disabled: ['sample', 'templates', 'browser', 'drawio', 'ocr', 'meeting'] },
    spellcheck: { enabled: false },
    llm: { enabled: true, provider: 'openai-compat', baseUrl: `http://127.0.0.1:${PORT}/v1`, apiKey: null, model: 'mock-model' },
  },
});

test('Pia sets the standard flow with a card and knows the owner as Henrik (req-306)', async ({ page, vaultDir }, testInfo) => {
  test.setTimeout(240_000);
  const panel = page.locator('app-panel-frame', { has: page.locator('.assistant-panel') });
  const switcher = panel.locator('.assistant-targets');
  await expect(switcher.locator('.assistant-target')).toHaveCount(3, { timeout: 30_000 });
  await switcher.getByLabel('Mission Control', { exact: true }).click();
  const input = panel.locator('.composer-input .cm-content');
  await input.click();
  await page.keyboard.type('Set the standard flow to Paul, Ben and then me, Henrik.');
  await page.keyboard.press('Enter');

  const thread = panel.locator('.target-thread');
  await expect(thread).toContainText(AGREED, { timeout: 60_000 });
  // She read the crew: the owner is the persona "you", named Henrik, and the turn carries the new command.
  const turn = requests.find((request) => request.system.includes('## Crew'));
  expect(turn, 'a mission turn with the crew block reached the model').toBeDefined();
  expect(turn!.system).toContain('- you (Henrik): the owner, Henrik');
  expect(turn!.system).toContain('- paul (Paul)');
  expect(turn!.system).toContain('flow — the owner wants the board\'s standard flow changed');

  const card = thread.locator('.target-card');
  await expect(card).toContainText('Set the standard flow to paul:shape; ben; you');
  await expect(card.locator('.target-card-btn')).toHaveText(['Confirm', 'Dismiss']);
  await page.screenshot({ path: testInfo.outputPath('pia-standard-flow-card.png') });

  // Nothing is written before the confirm.
  const pipeline = path.join(vaultDir, 'tickets', '_meta', 'pipeline.md');
  expect(fs.readFileSync(pipeline, 'utf8')).toMatch(/^flow: paul:shape; ben; ralf; tessa; you\s*$/m);
  await card.locator('.target-card-btn', { hasText: 'Confirm' }).click();
  await expect(card).toContainText('Confirmed', { timeout: 30_000 });
  await expect.poll(() => fs.readFileSync(pipeline, 'utf8'), { timeout: 30_000 }).toMatch(/^flow: paul:shape; ben; you\s*$/m);
  stopEngine();
});
