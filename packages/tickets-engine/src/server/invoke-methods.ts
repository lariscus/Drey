/**
 * Method names the invoke channel exposes (the table of `invoke-table.ts`).
 * Everything else stays internal. `FLEET_METHODS` is the fleet client's own
 * list (`fleet-methods.ts`).
 */
export const BOARD_METHODS = [
  'snapshot', 'storeListing', 'refresh', 'readTicket', 'refineTicket', 'setPriority', 'setTrack', 'setClass', 'saveAttachment',
  'createTicket', 'transition', 'archive', 'unarchive', 'acceptTicket', 'sendBack', 'answerNeed', 'ticketComments', 'archivedTickets', 'launchVersion',
  'changesOf', 'worktreeChangesOf', 'removeWorktreeForTicket', 'worktreeCleanup', 'worktreeBootSweep',
  'worktreesStatus', 'chainRefusal', 'setClaim', 'startRun', 'setColumnConfig', 'listPrompts', 'savePrompt',
  'restoreShippedPrompts', 'listRepos', 'saveRepos', 'pickFolder', 'scanRepos', 'listProjects',
  'switchProject', 'openTicketsFolder', 'folderStatus', 'numberFolders', 'reorderPhases', 'editPhase',
  'personaLearn', 'listPersonas', 'verifyTicket', 'verifyStatus', 'estimateOf',
  'chatSessions', 'chatOpen', 'chatSend', 'chatStart', 'chatConfirm', 'chatDismiss', 'chatShapeDecide', 'chatPlanStatus',
  'ticketDocument', 'saveDocument', 'setHumanName',
  'initialize', 'onVaultEvent', 'migrateStoreStages', 'personaBoardMove', 'migrateBoard',
] as const;

// The team's reads and controls (E13-8): the remote port's own methods, so
// Drey's Team tab and Capacity band show exactly what the phone shows.
// None of these names is in the board or fleet tables (a later register() wins).
export const TEAM_METHODS = [
  'personas', 'handoffRun', 'chainPersonaPause', 'chainAutopilot', 'personaThread', 'personaThreadAppend', 'personaProposalDecide',
  'personaMemory', 'personaMemoryAppend', 'personaMemoryPin', 'personaMemoryRemove', 'personaJournal', 'personaJournalRemove', 'planParts',
  // The Persona page (board 7k): the phone's setup write and improvements card.
  'personaPatch', 'personaImprovements', 'personaImprovementDecide',
  // req-172: the Skills tab and the prompt preview (the same service the routes call).
  'sharedSkills', 'personaSkills', 'personaSkillToggle', 'personaSkillRemove', 'skillUpload', 'personaPromptPreview',
  // req-261: delete a persona, confirmed by its typed title.
  'personaRemove',
  // req-292: a persona's picture as a data URL (the Crew's circles).
  'personaAvatar',
  // req-281/293: Mission Control's persona's instructions and the assistant's models for her Model choice.
  'personaInstructions', 'chatModels',
] as const;

// pair/revoke take primitive args; the invoke channel carries one object
// payload, so both get explicit adapters (the generic register would hand
// the whole payload where a string is expected).
export const REMOTE_METHODS = ['status', 'configure', 'init', 'localClient', 'cancelPairing'] as const;
