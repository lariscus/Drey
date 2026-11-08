import { describe, expect, it } from 'vitest';
import { MemoryFileSystem } from '../ports/memory-file-system.fake';
import { ServiceConfigFile } from './service-config-file';
import { slotEnv } from './slot';
import { DEFAULT_REFRESH_MS, parseServiceSlots } from './slot-config';

/** The owner's machine as board 7l draws it. */
const SAMPLE = {
  slots: [
    { id: 'claude-a', label: 'Claude A', provider: 'claude-code', profile: 'private', sessions: 2, billing: { kind: 'subscription', pricePerMonth: 90, currency: 'EUR' }, login: { claudeConfigDir: 'C:/Users/o/.claude-a' } },
    { id: 'claude-b', label: 'Claude B', provider: 'claude-code', billing: { kind: 'subscription', pricePerMonth: 90 }, login: { claudeConfigDir: 'C:/Users/o/.claude-b' } },
    { id: 'zai', label: 'z.ai', provider: 'opencode', login: { opencodeAuthEntry: 'zai-coding-plan' } },
    { id: 'copilot', label: 'Copilot', provider: 'opencode', profile: 'work', billing: { kind: 'credits', pricePerCredit: 0.04 }, limits: [{ window: 'month', budget: 1000, unit: 'runs' }] },
  ],
  quota: { refreshMinutes: 5 },
  models: [{ id: 'kept by req-170' }],
};

describe('parseServiceSlots — the slots of service.json', () => {
  it('reads every slot in its order, derives the quota source, and implies a slot for a provider none names', () => {
    const parsed = parseServiceSlots(SAMPLE);
    expect(parsed.errors).toEqual([]);
    expect(parsed.refreshMs).toBe(5 * 60_000);
    expect(parsed.slots.map((s) => [s.id, s.provider, s.profile, s.quota, s.implied])).toEqual([
      ['claude-a', 'claude-code', 'private', 'claude-code', false],
      ['claude-b', 'claude-code', 'private', 'claude-code', false],
      ['zai', 'opencode', 'private', 'zai', false],
      ['copilot', 'opencode', 'work', 'counting', false],
      ['kimi', 'kimi', 'private', 'counting', true],
    ]);
    expect(parsed.slots[0]).toMatchObject({ label: 'Claude A', sessions: 2, billing: { kind: 'subscription', pricePerMonth: 90, currency: 'EUR' } });
    expect(parsed.slots[3]).toMatchObject({ billing: { kind: 'credits', pricePerCredit: 0.04 }, limits: [{ window: 'month', budget: 1000, unit: 'runs' }] });
  });

  it('a machine without slots runs every provider on an implied private slot that makes no network call', () => {
    const parsed = parseServiceSlots({});
    expect(parsed.refreshMs).toBe(DEFAULT_REFRESH_MS);
    expect(parsed.slots.map((s) => [s.id, s.label, s.profile, s.quota, s.sessions])).toEqual([
      ['opencode', 'OpenCode', 'private', 'counting', null],
      ['claude-code', 'Claude Code', 'private', 'claude-code', null],
      ['kimi', 'Kimi', 'private', 'counting', null],
    ]);
  });

  it('a configured Kimi slot reads its usages endpoint; an explicit quota key wins', () => {
    const parsed = parseServiceSlots({ slots: [{ id: 'kimi', provider: 'kimi' }, { id: 'lm', provider: 'opencode', quota: 'zai' }] });
    expect(parsed.slots.slice(0, 2).map((s) => s.quota)).toEqual(['kimi', 'zai']);
  });

  it('leaves out a broken entry with its reason; the others stand', () => {
    const parsed = parseServiceSlots({ slots: [{ id: 'a', provider: 'claude-code' }, { id: 'a', provider: 'kimi' }, { id: 'b', provider: 'copilot' }, { id: 'c', provider: 'kimi', profile: 'home' }, { provider: 'kimi' }] });
    expect(parsed.slots.filter((s) => !s.implied).map((s) => s.id)).toEqual(['a']);
    expect(parsed.errors).toHaveLength(4);
    expect(parsed.errors[0]).toBe('slot "a" is named twice');
  });

  it('never takes a key: only the login references are kept', () => {
    const parsed = parseServiceSlots({ slots: [{ id: 'a', provider: 'claude-code', login: { claudeConfigDir: '/c', apiKey: 'sk-secret' }, apiKey: 'sk-secret' }] });
    expect(JSON.stringify(parsed.slots)).not.toContain('sk-secret');
  });

  it("an implied slot never takes a configured slot's id", () => {
    const parsed = parseServiceSlots({ slots: [{ id: 'kimi', provider: 'claude-code' }] });
    expect(parsed.slots.map((s) => s.id)).toEqual(['kimi', 'opencode', 'kimi-default']);
  });
});

describe("slotEnv — the account a worker is spawned as", () => {
  it("a Claude account is its CLAUDE_CONFIG_DIR, a second Kimi its KIMI_HOME, the default login nothing", () => {
    const [claudeA, , zai] = parseServiceSlots(SAMPLE).slots;
    expect(slotEnv(claudeA!)).toEqual({ CLAUDE_CONFIG_DIR: 'C:/Users/o/.claude-a' });
    expect(slotEnv(zai!)).toBeUndefined();
    expect(slotEnv(parseServiceSlots({ slots: [{ id: 'k2', provider: 'kimi', login: { kimiHome: '/k2' } }] }).slots[0]!)).toEqual({ KIMI_HOME: '/k2' });
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

  it('never overwrites a file that does not parse', async () => {
    const fs = new MemoryFileSystem();
    fs.files.set(PATH, '{ "slots": [ ');
    const file = new ServiceConfigFile(fs, PATH);
    expect((await file.read()).error).toMatch(/does not parse/);
    expect((await file.writeSlots([])).ok).toBe(false);
    expect(fs.files.get(PATH)).toBe('{ "slots": [ ');
  });
});
