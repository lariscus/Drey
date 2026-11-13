/**
 * The cheap GETs against the assistant's connection (D-1, req-293): the
 * settings screen's "Test connection" and the model list a Persona page
 * offers Mission Control's persona. Both resolve the config like a turn
 * would and ask the endpoint for its model list (no tokens spent).
 */
import type { ChatModelsReply } from '../contracts/chat-models';
import { ANTHROPIC_VERSION, causeOf, chatFailure, httpReason, resolveChatModel, TEST_TIMEOUT_MS, type ChatModelConfig, type ChatModelSpec } from './chat-model';

export interface ChatTestResult {
  readonly ok: boolean;
  readonly message: string;
}

function listRequest(spec: ChatModelSpec): { readonly url: string; readonly headers: Record<string, string> } {
  const url = spec.dialect === 'openai' ? `${spec.baseUrl}/models` : `${spec.baseUrl}/v1/models`;
  const headers: Record<string, string> =
    spec.dialect === 'openai'
      ? spec.apiKey === null
        ? {}
        : { authorization: `Bearer ${spec.apiKey}` }
      : { 'anthropic-version': ANTHROPIC_VERSION, ...(spec.apiKey === null ? {} : { 'x-api-key': spec.apiKey }) };
  return { url, headers };
}

function modelIds(body: string): string[] {
  try {
    const data = (JSON.parse(body) as { data?: unknown }).data;
    return Array.isArray(data)
      ? data.flatMap((entry): string[] => {
          const id = typeof entry === 'object' && entry !== null ? (entry as { id?: unknown }).id : undefined;
          return typeof id === 'string' ? [id] : [];
        })
      : [];
  } catch {
    return [];
  }
}

/**
 * The settings screen's "Test connection". A host without the listing but
 * reachable counts as reachable — Drey lets the model id be typed by hand
 * for such hosts.
 */
export async function testChatModel(config: ChatModelConfig, transport: typeof fetch = fetch): Promise<ChatTestResult> {
  const resolved = await resolveChatModel(config);
  if (!resolved.ok) {
    return { ok: false, message: resolved.failure.message };
  }
  const { spec } = resolved;
  const { url, headers } = listRequest(spec);
  try {
    const response = await transport(url, { method: 'GET', headers, signal: AbortSignal.timeout(TEST_TIMEOUT_MS) });
    const body = await response.text().catch(() => '');
    if (response.ok) {
      const ids = modelIds(body);
      const known = ids.length === 0 || ids.includes(spec.model);
      return {
        ok: true,
        message: known
          ? `Connected to ${spec.providerLabel} at ${spec.baseUrl}. Model ${spec.model}${ids.length === 0 ? ' (the endpoint lists no models).' : ' is available.'}`
          : `Connected to ${spec.providerLabel} at ${spec.baseUrl}, but it does not list the model ${spec.model}. Pick another in Drey → Settings → Assistant.`,
      };
    }
    if (response.status === 404 || response.status === 405) {
      return { ok: true, message: `Reached ${spec.providerLabel} at ${spec.baseUrl} — it exposes no model list, so the model ${spec.model} is untested.` };
    }
    return { ok: false, message: chatFailure('refused', spec.provider, spec.baseUrl, spec.model, httpReason(response.status, body)).message };
  } catch (error) {
    const reason = error instanceof Error && error.name === 'TimeoutError' ? 'no answer within 8 seconds.' : `could not be reached — ${causeOf(error)}.`;
    return { ok: false, message: chatFailure('unreachable', spec.provider, spec.baseUrl, spec.model, reason).message };
  }
}

/**
 * req-293: the assistant's connection and the models its endpoint lists —
 * what Mission Control's persona may pin. A failing or absent listing is an
 * empty `models` list, never a refusal: the model id stays hand-enterable.
 * Only a connection the bridge cannot use at all answers `ok: false`.
 */
export async function listChatModels(config: ChatModelConfig, transport: typeof fetch = fetch): Promise<ChatModelsReply> {
  const resolved = await resolveChatModel(config);
  if (!resolved.ok) {
    return { ok: false, error: resolved.failure.message };
  }
  const { spec } = resolved;
  const { url, headers } = listRequest(spec);
  let models: string[] = [];
  try {
    const response = await transport(url, { method: 'GET', headers, signal: AbortSignal.timeout(TEST_TIMEOUT_MS) });
    models = response.ok ? modelIds(await response.text().catch(() => '')) : [];
  } catch {
    models = [];
  }
  return { ok: true, provider: spec.provider, providerLabel: spec.providerLabel, assistantModel: spec.model, models: [...new Set(models)].sort((a, b) => a.localeCompare(b)) };
}
