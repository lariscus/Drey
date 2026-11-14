import { PERSONA_RUN_METHODS, type ClosingRoundWrite, type RunJournalWrite, type RunMemoryWrite } from '../contracts/persona-run-records';
import type { EngineParts } from './engine-parts';
import type { InvokeTable } from './invoke-table';

function objectOf(payload: unknown, method: string): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || typeof (payload as Record<string, unknown>)['persona'] !== 'string') {
    throw new Error(`${method} expects an object with a persona`);
  }
  return payload as Record<string, unknown>;
}

function textField(obj: Record<string, unknown>, key: string, method: string): string {
  const value = obj[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${method} expects a non-empty ${key}`);
  }
  return value;
}

/**
 * The runs' writes into their persona's records: the runner's closing round
 * and the worker's `memory_write` / `journal_write` through Drey Service's
 * vault MCP — all to the engine's one writer, `PersonaRunRecords`.
 */
export function addPersonaRunMethods(table: InvokeTable, parts: EngineParts): void {
  const records = parts.sessions.personaRunRecords;
  table.set(PERSONA_RUN_METHODS.closingRound, (payload) => {
    const obj = objectOf(payload, PERSONA_RUN_METHODS.closingRound);
    textField(obj, 'vaultPath', PERSONA_RUN_METHODS.closingRound);
    return records.closingRound(obj as unknown as ClosingRoundWrite);
  });
  table.set(PERSONA_RUN_METHODS.memory, (payload) => {
    const obj = objectOf(payload, PERSONA_RUN_METHODS.memory);
    textField(obj, 'lesson', PERSONA_RUN_METHODS.memory);
    return records.memoryWrite(obj as unknown as RunMemoryWrite);
  });
  table.set(PERSONA_RUN_METHODS.journal, (payload) => {
    const obj = objectOf(payload, PERSONA_RUN_METHODS.journal);
    textField(obj, 'note', PERSONA_RUN_METHODS.journal);
    return records.journalWrite(obj as unknown as RunJournalWrite);
  });
}
