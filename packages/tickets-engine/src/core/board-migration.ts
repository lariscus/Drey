/**
 * The live board migration's steps 3–5 (req-268, concept §12), pure: what the
 * meta vault's files become once the store runs on the lifecycle stages. The
 * contract and the order of the steps are `contracts/board-migration.ts`;
 * BoardService reads the files, offers the next step and writes it on the
 * owner's confirmation.
 */
import { isMap, isSeq, parseDocument, type Document, type YAMLMap, type YAMLSeq } from 'yaml';
import { splitFrontmatter } from '../../../../shared/frontmatter';
import { LEGACY_DEFAULT_PERSONAS, type CrewMigrationPlan, type DefaultsMigrationPlan, type PipelineMigrationPlan } from '../contracts/board-migration';
import type { PersonaSettingsPatch } from '../contracts/persona-settings-patch';
import { chainItemsOf, parseChainItems } from './chain-list';
import { crewOrderOf, inCrewOrder } from './crew-order';
import { EDGE_STAGES } from './lifecycle-stages';
import { HUMAN_PERSONA_ID, MISSION_PERSONA_ID, type Persona } from './persona';
import { classNameOf, type ClassName } from '../contracts/capability-class';
import { raisedToFloor } from './persona-model-migration';
import { LIFECYCLE_PIPELINE_PROSE, PIPELINE_PROSE, STANDARD_FLOW_LINE } from './pipeline-states';

/** The run keys a working column carried that move onto the builder's record (concept §5). */
const MOVED_KEYS = ['min-class', 'needs', 'max-turns', 'max-work'] as const;

/** Keys no ruling gives a home (§14 reading 9): they go with their column, named to the owner first. */
const HOMELESS_KEYS: readonly string[] = ['ci', 'audit', 'semantic'];

/** The builder of a flow: the first persona after the shape persona's leading entries (Ben in the standard flow). */
export function builderOf(flowLine: string, personas: readonly Pick<Persona, 'id' | 'kind'>[]): string | null {
  const parsed = parseChainItems(chainItemsOf(flowLine));
  if (!parsed.ok || parsed.entries.length === 0) {
    return null;
  }
  const shaper = parsed.entries.find((entry) => entry.mode === 'shape')?.persona ?? parsed.entries[0]!.persona;
  const builder = parsed.entries.find((entry) => entry.persona !== shaper)?.persona ?? null;
  return builder !== null && personas.some((persona) => persona.id === builder && persona.kind === 'agent') ? builder : null;
}

function scalar(map: YAMLMap, key: string): unknown {
  const value = map.get(key);
  return typeof value === 'object' && value !== null && 'toJSON' in value ? (value as { toJSON(): unknown }).toJSON() : value;
}

type MutablePatch = { -readonly [K in keyof PersonaSettingsPatch]: PersonaSettingsPatch[K] };

/** The builder as the move reads it: its class (or v2 keys) and its settings. */
type MoveBuilder = Pick<Persona, 'kind' | 'class' | 'legacy' | 'settings'>;

/** `needs` onto the patch where the builder sets none; `min-class` as the floor its class is raised to, when it raises it (req-288 folded the floor into `class:`). */
function moveClassAndNeeds(found: ReadonlyMap<string, unknown>, builder: MoveBuilder, patch: MutablePatch, keys: string[]): ClassName | null {
  const named = classNameOf(found.get('min-class'));
  const floor = named !== null && raisedToFloor(builder, named) !== builder ? named : null;
  if (floor !== null) {
    keys.push('min-class');
  }
  const needs = found.get('needs');
  if (needs !== undefined && builder.settings.needs === null) {
    patch.needs = Array.isArray(needs) ? needs.join(', ') : String(needs);
    keys.push('needs');
  }
  return floor;
}

/** The builder's settings patch for the moved keys — only those its record does not set already. */
function movedPatch(found: ReadonlyMap<string, unknown>, builder: MoveBuilder | null): { readonly patch: PersonaSettingsPatch; readonly keys: readonly string[]; readonly floor: ClassName | null } {
  const patch: MutablePatch = {};
  const keys: string[] = [];
  if (builder === null) {
    return { patch, keys, floor: null };
  }
  const floor = moveClassAndNeeds(found, builder, patch, keys);
  for (const [key, field] of [['max-turns', 'maxTurns'], ['max-work', 'maxWorkMin']] as const) {
    const value = found.get(key);
    if (typeof value === 'number' && Number.isInteger(value) && value > 0 && builder.settings[field] === null) {
      patch[field] = value;
      keys.push(key);
    }
  }
  return { patch, keys, floor };
}

/** The run keys, the token budget and the homeless keys the removed columns carried (the first column's value wins). */
function removedKeysOf(removed: readonly YAMLMap[]): { readonly found: ReadonlyMap<string, unknown>; readonly dropped: readonly string[] } {
  const found = new Map<string, unknown>();
  const dropped: string[] = [];
  for (const item of removed) {
    for (const key of [...MOVED_KEYS, 'token-budget', ...HOMELESS_KEYS]) {
      const value = scalar(item, key);
      if (value === undefined || value === null || found.has(key)) {
        continue;
      }
      found.set(key, value);
      if (HOMELESS_KEYS.includes(key)) {
        dropped.push(`${key}: ${String(value)}`);
      }
    }
  }
  return { found, dropped };
}

/** The pipeline document with only the kept columns (their `persona:` gone), the flow and the board's token budget. */
function rewritten(doc: Document, phases: YAMLSeq, kept: readonly YAMLMap[], adds: { readonly flowLine: string | null; readonly tokenBudget: number | null }): void {
  const { flowLine, tokenBudget } = adds;
  for (const item of kept) {
    item.delete('persona'); // the chain says who; a column persona is gone (concept §8)
  }
  phases.items = [...kept];
  if (flowLine === null) {
    doc.set('flow', STANDARD_FLOW_LINE);
  }
  if (tokenBudget !== null && !doc.has('token-budget')) {
    doc.set('token-budget', tokenBudget);
  }
}

/** The columns of a pipeline split into the lifecycle ones it keeps and the rest. */
function splitColumns(phases: YAMLSeq): { readonly kept: readonly YAMLMap[]; readonly removed: readonly YAMLMap[] } {
  const items = phases.items.filter((item): item is YAMLMap => isMap(item));
  const terminal = items.length > 0 ? String(scalar(items[items.length - 1]!, 'id')) : null;
  const keep = (item: YAMLMap): boolean => {
    const id = String(scalar(item, 'id'));
    return EDGE_STAGES.includes(id) || id === terminal;
  };
  return { kept: items.filter(keep), removed: items.filter((item) => !keep(item)) };
}

function budgetOf(raw: unknown): number | null {
  return typeof raw === 'number' && raw > 0 ? raw : null;
}

/** What step 3 writes and offers. */
export interface PipelineMigration {
  readonly plan: PipelineMigrationPlan;
  readonly text: string;
  readonly builder: string | null;
  readonly patch: PersonaSettingsPatch;
  /** A removed column's `min-class`: the builder's class is raised to it, never lowered (req-288). */
  readonly floor: ClassName | null;
}

/** Step 3 over `pipeline.md`; null when the file holds only the lifecycle columns and a `flow:` already. */
export function pipelineMigrationOf(pipelineText: string, personas: readonly (Pick<Persona, 'id'> & MoveBuilder)[]): PipelineMigration | null {
  const { yamlText, body, hadFence } = splitFrontmatter(pipelineText);
  const doc = parseDocument(yamlText ?? '');
  const phases = doc.get('phases');
  if (!hadFence || !isSeq(phases)) {
    return null;
  }
  const { kept, removed } = splitColumns(phases);
  const flowLine = typeof doc.get('flow') === 'string' ? String(doc.get('flow')) : null;
  if (removed.length === 0 && flowLine !== null) {
    return null;
  }
  const { found, dropped } = removedKeysOf(removed);
  const builder = builderOf(flowLine ?? STANDARD_FLOW_LINE, personas);
  const moved = movedPatch(found, personas.find((persona) => persona.id === builder) ?? null);
  const tokenBudget = budgetOf(found.get('token-budget'));
  rewritten(doc, phases, kept, { flowLine, tokenBudget });
  const prose = body.trim() === PIPELINE_PROSE.trim() ? LIFECYCLE_PIPELINE_PROSE : body;
  const plan: PipelineMigrationPlan = {
    step: 'pipeline',
    removed: removed.map((item) => String(scalar(item, 'title') ?? scalar(item, 'id'))),
    flow: flowLine === null ? STANDARD_FLOW_LINE : null,
    moved: movedOf(builder, moved.keys),
    tokenBudget,
    dropped,
  };
  return { plan, text: `---\n${doc.toString({ lineWidth: 0 })}---\n${prose}`, builder, patch: moved.patch, floor: moved.floor };
}

function movedOf(builder: string | null, keys: readonly string[]): PipelineMigrationPlan['moved'] {
  return keys.length > 0 && builder !== null ? { persona: builder, keys } : null;
}

/** The persona ids of a flow line in their first order (the team's order the standard flow implies). */
export function flowOrderOf(flowLine: string): readonly string[] {
  const parsed = parseChainItems(chainItemsOf(flowLine));
  return parsed.ok ? [...new Set(parsed.entries.map((entry) => entry.persona))] : [];
}

/**
 * Step 4: `order:` when the crew file has none — Mission Control first, then the personas in the order the
 * flow names them (`flowOrder`), the rest in pipeline order, You last — and the builder's `sync-main` and
 * You's `commit` where missing; null = nothing to do.
 */
export function crewMigrationOf(crewText: string | null, personas: readonly Persona[], builder: string | null, flowOrder: readonly string[] = []): CrewMigrationPlan | null {
  const crew = personas.filter((persona) => !LEGACY_DEFAULT_PERSONAS.includes(persona.id));
  const listed = crewOrderOf(crewText);
  const ordered = inCrewOrder(crew, flowOrder).map((persona) => persona.id).filter((id) => id !== MISSION_PERSONA_ID && id !== HUMAN_PERSONA_ID);
  const order = listed.length > 0 ? null : [...(crew.some((p) => p.id === MISSION_PERSONA_ID) ? [MISSION_PERSONA_ID] : []), ...ordered, ...(crew.some((p) => p.id === HUMAN_PERSONA_ID) ? [HUMAN_PERSONA_ID] : [])];
  const leaving: { persona: string; action: 'sync-main' | 'commit' }[] = [];
  const builderRecord = crew.find((persona) => persona.id === builder);
  if (builderRecord !== undefined && !builderRecord.settings.leaving.includes('sync-main')) {
    leaving.push({ persona: builderRecord.id, action: 'sync-main' });
  }
  const you = crew.find((persona) => persona.id === HUMAN_PERSONA_ID);
  if (you !== undefined && !you.settings.leaving.includes('commit')) {
    leaving.push({ persona: you.id, action: 'commit' });
  }
  return order === null && leaving.length === 0 ? null : { step: 'crew', order, leaving };
}

/** Step 5: the legacy default personas still there; their prompts compared with the builder's. Null = none left. */
export function defaultsMigrationOf(personas: readonly Pick<Persona, 'id' | 'title'>[], prompts: ReadonlyMap<string, string>, builder: string | null): DefaultsMigrationPlan | null {
  const left = personas.filter((persona) => LEGACY_DEFAULT_PERSONAS.includes(persona.id));
  if (left.length === 0) {
    return null;
  }
  const own = builder === null ? null : (prompts.get(builder) ?? '').trim();
  return {
    step: 'defaults',
    personas: left.map((persona) => ({ id: persona.id, title: persona.title, promptDiffers: own !== null && (prompts.get(persona.id) ?? '').trim() !== '' && (prompts.get(persona.id) ?? '').trim() !== own })),
    comparedWith: builder,
  };
}
