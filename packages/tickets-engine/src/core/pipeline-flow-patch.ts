/**
 * The writer of pipeline.md's two flow keys (E10-5b, the settings page's
 * default flow): `flow:` — the standard flow as one chain line — and
 * `propose-flow:`. A yaml document edit like `patchPipelinePhase`: comments,
 * the other keys and the prose body stay; an off switch removes its key.
 */
import { parseDocument } from 'yaml';
import { splitFrontmatter } from '../../../../shared/frontmatter';
import { FLOW_KEY, PROPOSE_FLOW_KEY } from './pipeline-flow';

export interface PipelineFlowPatch {
  /** The standard flow's canonical entries; an empty list removes the key. */
  readonly flow?: readonly string[];
  readonly proposeFlow?: boolean;
}

/** Throws on a file without a fence or one that does not parse — the caller refuses. */
export function patchPipelineFlow(text: string, patch: PipelineFlowPatch): string {
  const { yamlText, body, hadFence } = splitFrontmatter(text);
  if (!hadFence || yamlText === null) {
    throw new Error('pipeline.md has no frontmatter fence');
  }
  const doc = parseDocument(yamlText);
  if (doc.errors.length > 0) {
    throw new Error('pipeline.md does not parse');
  }
  if (patch.flow !== undefined) {
    if (patch.flow.length === 0) {
      doc.delete(FLOW_KEY);
    } else {
      doc.set(FLOW_KEY, patch.flow.join('; '));
    }
  }
  if (patch.proposeFlow !== undefined) {
    if (patch.proposeFlow) {
      doc.set(PROPOSE_FLOW_KEY, true);
    } else {
      doc.delete(PROPOSE_FLOW_KEY);
    }
  }
  let yaml = doc.toString({ flowCollectionPadding: false, lineWidth: 0 });
  if (!yaml.endsWith('\n')) {
    yaml += '\n';
  }
  return `---\n${yaml}---\n${body}`;
}
