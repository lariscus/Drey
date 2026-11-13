import { describe, expect, it } from 'vitest';
import type { ModelRow } from '../protocol';
import { MODELS_DEV_URL, ModelsDevImport } from './models-dev-import';
import { FakeQuotaHttp, fixture } from './routing.fake';

const row = (model: string, over: Partial<ModelRow> = {}): ModelRow => ({ model, slot: null, provider: 'claude-code', category: '', class: 'standard', cost: 1, enabled: true, ...over });
const registry = (): FakeQuotaHttp => new FakeQuotaHttp(() => ({ status: 200, body: fixture('models-dev-api.json') }));

describe('ModelsDevImport — the one-shot capability import (req-178)', () => {
  it("fills the undeclared columns from the registry, through the HTTP port, once", async () => {
    const http = registry();
    const outcome = await new ModelsDevImport(http).fill([row('claude-sonnet-4-5'), row('glm-5.3', { slot: 'zai', provider: 'opencode' }), row('kimi-k2.6', { provider: 'kimi' })]);
    expect(http.calls).toEqual([{ url: MODELS_DEV_URL, headers: {} }]);
    expect(outcome).toMatchObject({ ok: true, unmatched: [] });
    if (!outcome.ok) {
      return;
    }
    expect(outcome.rows.map((r) => [r.model, r.input, r.tools, r.context, r.output])).toEqual([
      ['claude-sonnet-4-5', ['text', 'image'], true, 200_000, 64_000],
      ['glm-5.3', ['text'], true, 1_000_000, 131_072],
      ['kimi-k2.6', ['text', 'image'], true, 262_144, 262_144],
    ]);
    expect(outcome.filled[1]).toEqual({ model: 'glm-5.3', where: 'zai', fields: ['input', 'tools', 'context', 'output'] });
  });

  it("keeps what the owner declared (the local override) and names a model it does not know", async () => {
    const outcome = await new ModelsDevImport(registry()).fill([row('claude-opus-4-6', { context: 200_000, input: ['text'] }), row('my-local-model')]);
    expect(outcome).toMatchObject({ ok: true, unmatched: ['my-local-model'] });
    if (!outcome.ok) {
      return;
    }
    expect(outcome.rows[0]).toMatchObject({ context: 200_000, input: ['text'], tools: true, output: 128_000 });
    expect(outcome.filled).toEqual([{ model: 'claude-opus-4-6', where: 'claude-code', fields: ['tools', 'output'] }]);
    expect(outcome.rows[1]).toEqual(row('my-local-model'));
  });

  it("an opencode model with a provider prefix is looked up there first", async () => {
    const outcome = await new ModelsDevImport(registry()).fill([row('zai-coding-plan/glm-5.3', { provider: 'opencode' })]);
    expect(outcome.ok && outcome.rows[0]?.context).toBe(1_000_000);
  });

  it.each([
    ['an HTTP error', { status: 503, body: null }, `${MODELS_DEV_URL} answered HTTP 503 — the model table is unchanged`],
    ['a body that is no registry', { status: 200, body: [1, 2] }, `${MODELS_DEV_URL} answered HTTP 200 — the model table is unchanged`],
  ])('%s changes nothing', async (_name, reply, error) => {
    const outcome = await new ModelsDevImport(new FakeQuotaHttp(() => reply)).fill([row('claude-sonnet-4-5')]);
    expect(outcome).toEqual({ ok: false, error });
  });

  it('a network failure changes nothing', async () => {
    const outcome = await new ModelsDevImport({ getJson: () => Promise.reject(new Error('offline')) }).fill([]);
    expect(outcome).toEqual({ ok: false, error: `${MODELS_DEV_URL} answered nothing — the model table is unchanged` });
  });
});
