// A stand-in for the coding-agent CLIs (req-286's e2e): it answers only what
// model discovery asks — Claude Code's stream-json `initialize`, an ACP
// agent's `initialize`, `session/new` and `session/delete` — with the board 7l
// v3 sample. No model is ever called, no account is touched. Started through
// the shims `fakeHarnessDir()` writes (`claude.cmd`, `opencode.cmd`, …):
//   node fake-harness.cjs <claude|opencode|kimi> [args…]
'use strict';

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

function claude(message) {
  if (message.type === 'control_request' && message.request && message.request.subtype === 'initialize') {
    send({
      type: 'control_response',
      response: { subtype: 'success', request_id: message.request_id, response: { claude_code_version: '2.1.319', account: { tokenSource: 'claude.ai' }, models: MODELS.claude } },
    });
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
