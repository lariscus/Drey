/**
 * The live board migration's steps 3–5 (req-268, concept §12), pure: what the
 * meta vault's files become once the store runs on the lifecycle stages. The
 * contract and the order of the steps are `contracts/board-migration.ts`;
 * BoardService reads the files, offers the next step and writes it on the
 * owner's confirmation.
 */
import { isMap, isSeq, parseDocument, type YAMLMap } from 'yaml';
import { splitFrontmatter } from '../../../../shared/frontmatter';
import { LEGACY_DEFAULT_PERSONAS, type CrewMigrationPlan, type DefaultsMigrationPlan, type PipelineMigrationPlan } from '../contracts/board-migration';
import type { PersonaSettingsPatch } from '../contracts/persona-settings-patch';
import { chainItemsOf, parseChainItems } from './chain-list';
import { crewOrderOf, inCrewOrder } from './crew-order';
import { EDGE_STAGES } from './lifecycle-stages';
import { HUMAN_PERSONA_ID, MISSION_PERSONA_ID, type Persona } from './persona';
import { PERSONA_CLASSES } from './persona-settings';
import { PIPELINE_PROSE, STANDARD_FLOW_LINE } from './pipeline-states';

/** The run keys a working column carried that move onto the builder's record (concept §5). */
const MOVED_KEYS = ['min-class', 'needs', 'max-turns', 'max-work'] as const;

/** Keys no ruling gives a home (§14 reading 9): they go with their column, named to the owner first. */
const HOMELESS_KEYS: readonly string[] = ['ci', 'audit', 'semantic'];

/** `pipeline.md`'s prose for a persona board (replaces the shipped phase-board prose only). */
export const LIFECYCLE_PIPELINE_PROSE = `The pipeline of a persona board: Inbox, Prioritized and Done are the
ticket's lifecycle columns; between them the board draws one column per
persona of the crew, in the crew's order (\`order:\` in crew.md). What a ticket
goes through is its chain, copied from \`flow:\` when it is created. See
specs/ticket-schema.md. Edit freely; the board follows on refresh.
`;

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

/** The builder's settings patch for the moved keys — only those its record does not set already. */
function movedPatch(found: ReadonlyMap<string, unknown>, builder: Pick<Persona, 'settings'> | null): { readonly patch: PersonaSettingsPatch; readonly keys: readonly string[] } {
  if (builder === null) {
    return { patch: {}, keys: [] };
  }
  const patch: { -readonly [K in keyof PersonaSettingsPatch]: PersonaSettingsPatch[K] } = {};
  const keys: string[] = [];
  const minClass = found.get('min-class');
  if (typeof minClass === 'string' && (PERSONA_CLASSES as readonly string[]).includes(minClass) && builder.settings.minClass === null) {
    patch.minClass = minClass as PersonaSettingsPatch['minClass'];
    keys.push('min-class');
  }
  const needs = found.get('needs');
  if (needs !== undefined && builder.settings.needs === null) {
    patch.needs = Array.isArray(needs) ? needs.join(', ') : String(needs);
    keys.push('needs');
  }
  for (const [key, field] of [['max-turns', 'maxTurns'], ['max-work', 'maxWorkMin']] as const) {
    const value = found.get(key);
    if (typeof value === 'number' && Number.isInteger(value) && value > 0 && builder.settings[field] === null) {
      patch[field] = value;
      keys.push(key);
    }
  }
  return { patch, keys };
}

/** Step 3 over `pipeline.md`; null when the file holds only the lifecycle columns and a `flow:` already. */
export function pipelineMigrationOf(
  pipelineText: string,
  personas: readonly Pick<Persona, 'id' | 'kind' | 'settings'>[],
): { readonly plan: PipelineMigrationPlan; readonly text: string; readonly builder: string | null; readonly patch: PersonaSettingsPatch } | null {
  const { yamlText, body, hadFence } = splitFrontmatter(pipelineText);
  const doc = parseDocument(yamlText ?? '');
  const phases = doc.get('phases');
  if (!hadFence || !isSeq(phases)) {
    return null;
  }
  const items = phases.items.filter((item): item is YAMLMap => isMap(item));
  const terminal = items.length > 0 ? String(scalar(items[items.length - 1]!, 'id')) : null;
  const keep = (item: YAMLMap): boolean => {
    const id = String(scalar(item, 'id'));
    return EDGE_STAGES.includes(id) || id === terminal;
  };
  const removed = items.filter((item) => !keep(item));
  const flowLine = typeof doc.get('flow') === 'string' ? String(doc.get('flow')) : null;
  if (removed.length === 0 && flowLine !== null) {
    return null;
  }
  const found = new Map<string, unknown>();
  const dropped: string[] = [];
  for (const item of removed) {
    for (const key of [...MOVED_KEYS, 'token-budget', ...HOMELESS_KEYS]) {
      const value = scalar(item, key);
      if (value !== undefined && value !== null && !found.has(key)) {
        found.set(key, value);
        if (HOMELESS_KEYS.includes(key)) {
          dropped.push(`${key}: ${String(value)}`);
        }
      }
    }
  }
  const builder = builderOf(flowLine ?? STANDARD_FLOW_LINE, personas);
  const moved = movedPatch(found, personas.find((persona) => persona.id === builder) ?? null);
  for (const item of items.filter(keep)) {
    item.delete('persona'); // the chain says who; a column persona is gone (concept §8)
  }
  phases.items = items.filter(keep);
  if (flowLine === null) {
    doc.set('flow', STANDARD_FLOW_LINE);
  }
  const budget = found.get('token-budget');
  const tokenBudget = typeof budget === 'number' && budget > 0 ? budget : null;
  if (tokenBudget !== null && !doc.has('token-budget')) {
    doc.set('token-budget', tokenBudget);
  }
  const prose = body.trim() === PIPELINE_PROSE.trim() ? LIFECYCLE_PIPELINE_PROSE : body;
  return {
    plan: {
      step: 'pipeline',
      removed: removed.map((item) => String(scalar(item, 'title') ?? scalar(item, 'id'))),
      flow: flowLine === null ? STANDARD_FLOW_LINE : null,
      moved: moved.keys.length > 0 && builder !== null ? { persona: builder, keys: moved.keys } : null,
      tokenBudget,
      dropped,
    },
    text: `---\n${doc.toString({ lineWidth: 0 })}---\n${prose}`,
    builder,
    patch: moved.patch,
  };
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
