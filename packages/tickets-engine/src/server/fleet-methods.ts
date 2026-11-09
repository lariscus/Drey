/**
 * The `FleetClient` methods the engine's invoke channel serves to Drey (the
 * plugin's `client.fleet()` proxy). req-177's slot reads and writes and
 * req-170's pool settings joined for the Settings → Models page (board 7l),
 * req-178's routing keys and capability import with them.
 */
export const FLEET_METHODS = [
  'runs',
  'start',
  'chainStatus',
  'stop',
  'send',
  'answerPermission',
  'answerQuestion',
  'stream',
  'setMaster',
  'setAutopilot',
  'setColumn',
  'stopColumn',
  'abortAll',
  'startPolling',
  'attach',
  'control',
  'log',
  'status',
  'retireIfIdle',
  'slots',
  'refreshSlots',
  'slotLoginDone',
  'writeSlots',
  'models',
  'writeModels',
  'importModelCapabilities',
] as const;
