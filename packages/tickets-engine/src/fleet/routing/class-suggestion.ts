/**
 * The class a new-model card proposes (req-286): a guess from the model's
 * name the owner confirms or changes before Add — the strongest class for a
 * Fable-class model, the second for Opus / Pro, the lightest for Haiku, Air,
 * Mini, Flash or Lite, the middle one otherwise. Never a decision on its own:
 * nothing enters the table without the owner's Add.
 */
const STRONGEST = /fable/i;
const HEAVY = /opus|(^|[-/])pro($|[-.])|k3/i;
const LIGHT = /haiku|air|mini|flash|lite|nano|small|free/i;

export function suggestedClassOf(model: string, classes: readonly string[]): string {
  const last = classes.length - 1;
  if (last < 0) {
    return 'standard';
  }
  if (STRONGEST.test(model)) {
    return classes[0]!;
  }
  if (LIGHT.test(model)) {
    return classes[last]!;
  }
  if (HEAVY.test(model)) {
    return classes[Math.min(1, last)]!;
  }
  return classes.includes('standard') ? 'standard' : classes[Math.floor(classes.length / 2)]!;
}
