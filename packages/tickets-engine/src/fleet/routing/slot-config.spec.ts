import { describe, expect, it } from 'vitest';
import { MemoryFileSystem } from '../ports/memory-file-system.fake';
import { ServiceConfigFile } from './service-config-file';
import { slotEnv } from './slot';
import { DEFAULT_REFRESH_MS, parseServiceSlots } from './slot-config';

/** The owner's machine as board 7l draws it. */
const SAMPLE = {
  slots: [
    { id: 'claude-a', label: 'Claude A', provider: 'claude-code', sessions: 2, billing: { kind: 'subscription', pricePerMonth: 90, currency: 'EUR' }, login: { claudeConfigDir: 'C:/Users/o/.claude-a' } },
    { id: 'claude-b', label: 'Claude B', provider: 'claude-code', billing: { kind: 'subscription', pricePerMonth: 90 }, login: { claudeConfigDir: 'C:/Users/o/.claude-b' } },
    { id: 'zai', label: 'z.ai', provider: 'opencode', login: { opencodeAuthEntry: 'zai-coding-plan' } },
    { id: 'copilot', label: 'Copilot', provider: 'opencode', billing: { kind: 'credits', pricePerCredit: 0.04 }, limits: [{ window: 'month', budget: 1000, unit: 'runs' }] },
  ],
  quota: { refreshMinutes: 5 },
  models: [{ id: 'kept by req-170' }],
};

describe('parseServiceSlots — the slots of service.json', () => {
  it('reads every slot in its order, derives the quota source, and implies a slot for a provider none names', () => {
    const parsed = parseServiceSlots(SAMPLE);
    expect(parsed.errors).toEqual([]);
    expect(parsed.refreshMs).toBe(5 * 60_000);
    expect(parsed.slots.map((s) => [s.id, s.provider, s.quota, s.implied])).toEqual([
      ['claude-a', 'claude-code', 'claude-code', false],
      ['claude-b', 'claude-code', 'claude-code', false],
      ['zai', 'opencode', 'zai', false],
      ['copilot', 'opencode', 'counting', false],
      ['kimi', 'kimi', 'counting', true],
      ['copilot-default', 'copilot', 'counting', true],
    ]);
    expect(parsed.slots[0]).toMatchObject({ label: 'Claude A', sessions: 2, billing: { kind: 'subscription', pricePerMonth: 90, currency: 'EUR' } });
    expect(parsed.slots[3]).toMatchObject({ billing: { kind: 'credits', pricePerCredit: 0.04 }, limits: [{ window: 'month', budget: 1000, unit: 'runs' }] });
  });

  it('req-290: an old profile key loads whatever it says and is silently ignored', () => {
    for (const profile of ['private', 'work', 'home']) {
      const parsed = parseServiceSlots({ slots: [{ id: 'claude-a', provider: 'claude-code', profile }] });
      expect(parsed.errors).toEqual([]);
      expect(parsed.slots[0]).toMatchObject({ id: 'claude-a', provider: 'claude-code' });
      expect('profile' in parsed.slots[0]!).toBe(false);
    }
  });

  it('a machine without slots runs every provider on an implied slot that makes no network call', () => {
    const parsed = parseServiceSlots({});
    expect(parsed.refreshMs).toBe(DEFAULT_REFRESH_MS);
    expect(parsed.slots.map((s) => [s.id, s.label, s.quota, s.sessions])).toEqual([
      ['opencode', 'OpenCode', 'counting', null],
      ['claude-code', 'Claude Code', 'claude-code', null],
      ['kimi', 'Kimi', 'counting', null],
      ['copilot', 'Copilot CLI', 'counting', null],
    ]);
  });

  it('a configured Kimi slot reads its usages endpoint; an explicit quota key wins', () => {
    const parsed = parseServiceSlots({ slots: [{ id: 'kimi', provider: 'kimi' }, { id: 'lm', provider: 'opencode', quota: 'zai' }] });
    expect(parsed.slots.slice(0, 2).map((s) => s.quota)).toEqual(['kimi', 'zai']);
  });

  it('leaves out a broken entry with its reason; the others stand', () => {
    const parsed = parseServiceSlots({ slots: [{ id: 'a', provider: 'claude-code' }, { id: 'a', provider: 'kimi' }, { id: 'b', provider: 'gemini' }, { provider: 'kimi' }] });
    expect(parsed.slots.filter((s) => !s.implied).map((s) => s.id)).toEqual(['a']);
    expect(parsed.errors).toHaveLength(3);
    expect(parsed.errors[0]).toBe('slot "a" is named twice');
  });

  it('never takes a key: only the login references are kept', () => {
    const parsed = parseServiceSlots({ slots: [{ id: 'a', provider: 'claude-code', login: { claudeConfigDir: '/c', apiKey: 'sk-secret' }, apiKey: 'sk-secret' }] });
    expect(JSON.stringify(parsed.slots)).not.toContain('sk-secret');
  });

  it("an implied slot never takes a configured slot's id", () => {
    const parsed = parseServiceSlots({ slots: [{ id: 'kimi', provider: 'claude-code' }] });
    expect(parsed.slots.map((s) => s.id)).toEqual(['kimi', 'opencode', 'kimi-default', 'copilot']);
  });
});

describe("slotEnv — the account a worker is spawned as", () => {
  it("a Claude account is its CLAUDE_CONFIG_DIR, a second Kimi its KIMI_HOME, the default login nothing", () => {
    const [claudeA, , zai] = parseServiceSlots(SAMPLE).slots;
    expect(slotEnv(claudeA!)).toEqual({ CLAUDE_CONFIG_DIR: 'C:/Users/o/.claude-a' });
    expect(slotEnv(zai!)).toBeUndefined();
    expect(slotEnv(parseServiceSlots({ slots: [{ id: 'k2', provider: 'kimi', login: { kimiHome: '/k2' } }] }).slots[0]!)).toEqual({ KIMI_HOME: '/k2' });
  });

  it('a second Copilot CLI account is its COPILOT_HOME, counted by the runner (req-182)', () => {
    const copilot = parseServiceSlots({ slots: [{ id: 'cp-work', provider: 'copilot', login: { copilotHome: 'C:/Users/o/.copilot-work' } }] }).slots[0]!;
    expect(slotEnv(copilot)).toEqual({ COPILOT_HOME: 'C:/Users/o/.copilot-work' });
    expect(copilot.quota).toBe('counting');
  });
});

describe('ServiceConfigFile — service.json in the service home', () => {
  const PATH = '/home/u/.drey-engine/service.json';

  it('creates the file when absent, and leaves an existing one alone', async () => {
    const fs = new MemoryFileSystem();
    const file = new ServiceConfigFile(fs, PATH);
    await file.ensure();
    expect(JSON.parse(fs.files.get(PATH) as string)).toEqual({ slots: [] });
    fs.files.set(PATH, '{"slots":[{"id":"x"}]}');
    await file.ensure();
    expect(fs.files.get(PATH)).toBe('{"slots":[{"id":"x"}]}');
  });

  it('writes the slots and keeps every key it does not know', async () => {
    const fs = new MemoryFileSystem();
    fs.files.set(PATH, JSON.stringify(SAMPLE));
    const file = new ServiceConfigFile(fs, PATH);
    expect(await file.writeSlots([{ id: 'z', provider: 'kimi' }])).toEqual({ ok: true });
    const written = JSON.parse(fs.files.get(PATH) as string) as typeof SAMPLE;
    expect(written.slots).toEqual([{ id: 'z', provider: 'kimi' }]);
    expect(written.models).toEqual(SAMPLE.models);
    expect(written.quota).toEqual(SAMPLE.quota);
  });

  it('req-290: a written slot list drops the retired profile key, and one added slot never carries it', async () => {
    const fs = new MemoryFileSystem();
    fs.files.set(PATH, JSON.stringify({ slots: [{ id: 'old', provider: 'claude-code', profile: 'work' }] }));
    const file = new ServiceConfigFile(fs, PATH);
    expect(await file.writeSlots([{ id: 'old', provider: 'claude-code', profile: 'work' }])).toEqual({ ok: true });
    expect(JSON.parse(fs.files.get(PATH) as string).slots).toEqual([{ id: 'old', provider: 'claude-code' }]);
    expect(await file.addSlot({ id: 'added', provider: 'kimi', profile: 'private' })).toMatchObject({ ok: true });
    expect(JSON.parse(fs.files.get(PATH) as string).slots).toEqual([{ id: 'old', provider: 'claude-code' }, { id: 'added', provider: 'kimi' }]);
  });

  it('never overwrites a file that does not parse', async () => {
    const fs = new MemoryFileSystem();
    fs.files.set(PATH, '{ "slots": [ ');
    const file = new ServiceConfigFile(fs, PATH);
    expect((await file.read()).error).toMatch(/does not parse/);
    expect((await file.writeSlots([])).ok).toBe(false);
    expect(fs.files.get(PATH)).toBe('{ "slots": [ ');
  });
});
