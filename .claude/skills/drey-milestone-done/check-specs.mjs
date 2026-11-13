#!/usr/bin/env node
// Deterministic half of the Definition of Done: checks the spec files for the
// mistakes a milestone close leaves most often. Run from the repo root:
//   node .claude/skills/drey-milestone-done/check-specs.mjs
// Exit 1 on an error, 0 otherwise (warnings are for the agent to judge).

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';

const root = process.cwd();
const SPEC_FILES = [
  'specs/roadmap.md',
  'specs/changelog.md',
  'specs/decisions.md',
  'specs/classifier-spec.md',
  'specs/frontmatter-schema.md',
  'specs/ticket-schema.md',
  'CLAUDE.md',
];

const errors = [];
const warnings = [];
const info = [];

function read(rel) {
  const path = join(root, rel);
  if (!existsSync(path)) {
    errors.push(`${rel}: missing — run from the repo root`);
    return '';
  }
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

const roadmap = read('specs/roadmap.md');
const changelog = read('specs/changelog.md');
if (!roadmap || !changelog) finish();

// --- Changelog: milestone headings -----------------------------------------
const clLines = changelog.split('\n');
const milestoneHeads = [];
clLines.forEach((line, i) => {
  const m = /^### Milestone (\d+)\b/.exec(line);
  if (m) milestoneHeads.push({ n: Number(m[1]), line: i + 1, text: line });
});
const counts = new Map();
for (const h of milestoneHeads) counts.set(h.n, (counts.get(h.n) ?? 0) + 1);
for (const [n, c] of counts) if (c > 1) errors.push(`changelog: milestone ${n} appears ${c} times`);

const maxMilestone = Math.max(0, ...milestoneHeads.map((h) => h.n));
const firstHead = milestoneHeads[0];
if (firstHead && firstHead.n !== maxMilestone) {
  errors.push(`changelog: top entry is milestone ${firstHead.n} (line ${firstHead.line}), but milestone ${maxMilestone} exists — newest first`);
}
if (firstHead) {
  const next = milestoneHeads[1]?.line ?? clLines.length;
  const body = clLines.slice(firstHead.line, next - 1).join('\n');
  info.push(`top changelog entry: ${firstHead.text.slice(0, 110)}`);
  if (!body.includes('Not yet manually verified by the owner')) {
    warnings.push(`changelog: top entry (milestone ${firstHead.n}) has no "Not yet manually verified by the owner" marker — fine only if the owner verified it`);
  }
}

// --- Ids shipped vs. open --------------------------------------------------
function idsIn(text) {
  const ids = new Set();
  for (const m of text.matchAll(/\breq-(\d+)([a-z]?)((?:\/\d+[a-z]?)*)/g)) {
    ids.add(`req-${m[1]}${m[2]}`);
    for (const extra of m[3].split('/').filter(Boolean)) ids.add(`req-${extra}`);
  }
  for (const m of text.matchAll(/\bD-(\d+)\b/g)) ids.add(`D-${m[1]}`);
  return ids;
}

const shipped = new Map(); // id -> changelog heading line
clLines.forEach((line, i) => {
  if (!line.startsWith('### ')) return;
  for (const id of idsIn(line)) if (!shipped.has(id)) shipped.set(id, i + 1);
});

const rmLines = roadmap.split('\n');
const openItems = new Map(); // id -> [roadmap lines]
let section = '';
rmLines.forEach((line, i) => {
  if (line.startsWith('### ')) section = line;
  // Follow-up rows carry the id of the milestone they follow up on.
  if (section.startsWith('### Follow-ups of shipped milestones')) return;
  const m = /^\s*- \*\*((?:req-\d+[a-z]?)|(?:D-\d+))\b/.exec(line);
  if (!m) return;
  const list = openItems.get(m[1]) ?? [];
  list.push(i + 1);
  openItems.set(m[1], list);
});
for (const [id, lines] of openItems) {
  if (lines.length > 1) errors.push(`roadmap: item ${id} is listed ${lines.length} times (lines ${lines.join(', ')})`);
  if (shipped.has(id)) {
    warnings.push(`roadmap line ${lines[0]}: ${id} is still open, but changelog line ${shipped.get(id)} names it in a heading — delete the row unless only part of it shipped`);
  }
}

// --- Next free ids ---------------------------------------------------------
function maxId(prefix, ...texts) {
  let max = 0;
  const re = new RegExp(`\\b${prefix}(\\d+)`, 'g');
  for (const t of texts) for (const m of t.matchAll(re)) max = Math.max(max, Number(m[1]));
  return max;
}
const decisions = read('specs/decisions.md');
const maxReq = maxId('req-', roadmap, changelog, decisions);
const maxDefect = maxId('D-', roadmap, changelog, decisions);
info.push(`next free ids: milestone ${maxMilestone + 1}, req-${maxReq + 1}, D-${maxDefect + 1}`);

// --- Roadmap status line ---------------------------------------------------
const statusLine = rmLines.find((l) => l.startsWith('**Status ('));
if (!statusLine) {
  warnings.push('roadmap: no "**Status (…)" line found');
} else {
  const date = /\*\*Status \(([^)]+)\)/.exec(statusLine)?.[1];
  info.push(`roadmap status date: ${date}`);
  const span = /milestones ([^]*?)(?:, plus|\bbuilt\b)/.exec(statusLine)?.[1] ?? '';
  const covered = new Set();
  for (const part of span.split(/,|\band\b/)) {
    const r = /(\d+)\s*[–-]\s*(\d+)/.exec(part);
    if (r) for (let n = Number(r[1]); n <= Number(r[2]); n++) covered.add(n);
    else {
      const s = /(\d+)/.exec(part);
      if (s) covered.add(Number(s[1]));
    }
  }
  if (covered.size === 0) warnings.push('roadmap: could not read the milestone list of the Status line');
  else if (!covered.has(maxMilestone)) {
    errors.push(`roadmap: the Status line's milestone list does not include milestone ${maxMilestone}`);
  }
}

// --- Relative links in the spec files resolve ------------------------------
for (const rel of SPEC_FILES) {
  const text = rel === 'specs/roadmap.md' ? roadmap : rel === 'specs/changelog.md' ? changelog : read(rel);
  if (!text) continue;
  const base = dirname(join(root, rel));
  const stripped = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  for (const m of stripped.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1];
    if (/^(?:[a-z]+:|#|<)/i.test(target)) continue;
    const pathPart = decodeURI(target.split('#')[0].replace(/:\d+$/, ''));
    if (!pathPart) continue;
    if (!existsSync(resolve(base, pathPart))) errors.push(`${rel}: broken link → ${target}`);
  }
}

finish();

function finish() {
  for (const l of info) console.log(`info   ${l}`);
  for (const l of warnings) console.log(`WARN   ${l}`);
  for (const l of errors) console.log(`ERROR  ${l}`);
  console.log(`\n${errors.length} error(s), ${warnings.length} warning(s)`);
  process.exit(errors.length ? 1 : 0);
}
