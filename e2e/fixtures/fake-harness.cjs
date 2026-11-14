// A stand-in for the coding-agent CLIs (req-286's e2e): it answers what
// model discovery asks — Claude Code's stream-json `initialize`, an ACP
// agent's `initialize`, `session/new` and `session/delete` — with the board 7l
// v3 sample. No model is ever called, no account is touched. Started through
// the shims `fakeHarnessDir()` writes (`claude.cmd`, `opencode.cmd`, …):
//   node fake-harness.cjs <claude|opencode|kimi> [args…]
//
// A Claude Code RUN turn (the crew e2e, req-78/148): every user message gets
// `system/init`, one assistant message and a success `result`, so the runner
// sees a finished turn (agent-done), closes stdin and the process exits. The
// script named by `DREY_FAKE_HARNESS_SCRIPT` (a JSON file the shim sets) may
// shape a turn by its instruction text — the first rule whose `match` regex
// matches applies:
//   { "log": "<file>",                       // one JSON line per user message
//     "rules": [{ "match": "T-0002",
//                 "write": { "file": "green.txt", "text": "ok" },  // into the cwd
//                 "hang": true,              // no result: the turn never ends
//                 "result": "Done." }] }
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const which = process.argv[2];
const MODELS = {
  claude: [
    { value: 'fable', resolvedModel: 'claude-fable-5-2', displayName: 'Fable', description: 'Fable 5.2 · Most capable' },
    { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus', description: 'Opus 5.5 · Complex tasks' },
    { value: 'sonnet', resolvedModel: 'claude-sonnet-5-5', displayName: 'Sonnet', description: 'Sonnet 5.5 · Routine tasks' },
    { value: 'haiku', resolvedModel: 'claude-haiku-5-5', displayName: 'Haiku', description: 'Haiku 5.5 · Quick answers' },
  ],
  opencode: ['zai-coding-plan/glm-5.3', 'zai-coding-plan/glm-5.3-air', 'github-copilot/gpt-5.4'],
  kimi: ['kimi-k3.1-pro', 'kimi-k2.5'],
};
const VERSION = { opencode: '2.0.32', kimi: '1.6' };

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

function script() {
  const file = process.env.DREY_FAKE_HARNESS_SCRIPT;
  if (!file) return { rules: [] };
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { rules: [] };
  }
}

function argAfter(flag) {
  const at = process.argv.indexOf(flag);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

const SESSION = argAfter('--resume') || `fake-${process.pid}-${Date.now()}`;

function textOf(message) {
  const content = message.message && message.message.content;
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? content.map((part) => (part && typeof part.text === 'string' ? part.text : '')).join('\n') : '';
}

/** One run turn: the rule the instruction matches, the log line, then init, a reply and (unless it hangs) the result. */
function claudeTurn(message) {
  const text = textOf(message);
  const config = script();
  const rule = (config.rules || []).find((r) => {
    try {
      return new RegExp(r.match).test(text);
    } catch {
      return false;
    }
  });
  if (config.log) {
    fs.appendFileSync(config.log, `${JSON.stringify({ pid: process.pid, cwd: process.cwd(), args: process.argv.slice(3), rule: rule ? rule.match : null, text })}\n`);
  }
  if (rule && rule.write) {
    fs.writeFileSync(path.resolve(process.cwd(), rule.write.file), rule.write.text || 'ok');
  }
  send({ type: 'system', subtype: 'init', session_id: SESSION, slash_commands: [] });
  const reply = (rule && rule.result) || 'Done.';
  send({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: reply }], usage: { input_tokens: 100, output_tokens: 20 } } });
  if (rule && rule.hang) return;
  send({ type: 'result', subtype: 'success', is_error: false, result: reply, total_cost_usd: 0.01, usage: { input_tokens: 100, output_tokens: 20 } });
}

function claude(message) {
  if (message.type === 'control_request' && message.request && message.request.subtype === 'initialize') {
    send({
      type: 'control_response',
      response: { subtype: 'success', request_id: message.request_id, response: { claude_code_version: '2.1.319', account: { tokenSource: 'claude.ai' }, models: MODELS.claude } },
    });
  } else if (message.type === 'user') {
    claudeTurn(message);
  }
}

function acp(message) {
  if (message.method === 'initialize') {
    send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1, agentInfo: { name: which, version: VERSION[which] }, agentCapabilities: { sessionCapabilities: { delete: {} } } } });
  } else if (message.method === 'session/new') {
    const options = MODELS[which].map((value) => ({ value, name: value }));
    send({ jsonrpc: '2.0', id: message.id, result: { sessionId: 'fake-1', configOptions: [{ id: 'model', category: 'model', type: 'select', currentValue: options[0].value, options }] } });
  } else if (message.id !== undefined) {
    send({ jsonrpc: '2.0', id: message.id, result: {} });
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let at = buffer.indexOf('\n');
  while (at >= 0) {
    const line = buffer.slice(0, at).trim();
    buffer = buffer.slice(at + 1);
    at = buffer.indexOf('\n');
    if (line === '') continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    (which === 'claude' ? claude : acp)(message);
  }
});
process.stdin.on('end', () => process.exit(0));
