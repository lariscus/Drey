#!/usr/bin/env node
// Generates specs/digest.md: the short, binding entry point into the four
// spec files an interactive session used to read whole (roadmap, decisions,
// frontmatter-schema, ticket-schema). The digest is DERIVED — never edited.
//
//   node scripts/gen-spec-digest.mjs            write specs/digest.md
//   node scripts/gen-spec-digest.mjs --check    exit 1 when it is stale
//   --root <dir>  repo root (default: cwd)      --out <file>  output path
//
// Deliberately free of line numbers and dates of the day (no Status line):
// the digest changes only when a principle, the finish line, a heading or a
// decision entry changes — not with every milestone. Look things up by
// heading or lead text: grep -n "<lead>" specs/decisions.md

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const root = resolve(opt('--root', process.cwd()));
const outPath = resolve(root, opt('--out', 'specs/digest.md'));
const checkOnly = args.includes('--check');

function read(rel) {
  const path = join(root, rel);
  if (!existsSync(path)) {
    console.error(`gen-spec-digest: ${rel} missing — run from the repo root`);
    process.exit(2);
  }
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

const MAX_LEAD = 90;
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const oneLine = (s) => s.replace(/\s+/g, ' ').trim();

/** Heading lines (levels 1..maxLevel), fenced code blocks skipped. */
function headings(lines, maxLevel = 3) {
  const found = [];
  let fenced = false;
  lines.forEach((line, i) => {
    if (/^```/.test(line)) fenced = !fenced;
    if (fenced) return;
    const m = /^(#{1,6}) (.+)$/.exec(line);
    if (m && m[1].length <= maxLevel) found.push({ level: m[1].length, text: m[2].trim(), at: i });
  });
  return found;
}

/** Body of the first heading matching `re`, up to the next heading of the same or a higher level. */
function section(lines, re) {
  const all = headings(lines, 6);
  const idx = all.findIndex((h) => re.test(h.text));
  if (idx < 0) return null;
  const start = all[idx];
  const next = all.slice(idx + 1).find((h) => h.level <= start.level);
  const body = lines.slice(start.at + 1, next ? next.at : lines.length);
  return body.join('\n').trim();
}

function headingIndex(lines) {
  return headings(lines, 3)
    .filter((h) => h.level >= 2)
    .map((h) => `${h.level === 2 ? '-' : '  -'} ${clip(h.text, 100)}`)
    .join('\n');
}

/** Bullets that open with `- ` at column 0 → joined entry text, with the section they sit in. */
function bulletEntries(lines) {
  const entries = [];
  let current = null;
  let sectionName = '';
  let fenced = false;
  const flush = () => {
    if (current) entries.push(current);
    current = null;
  };
  for (const line of lines) {
    if (/^```/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const h = /^(#{1,6}) (.+)$/.exec(line);
    if (h) {
      flush();
      if (h[1].length === 2) sectionName = h[2].trim();
      continue;
    }
    if (/^- /.test(line)) {
      flush();
      current = { section: sectionName, text: line.slice(2) };
    } else if (current && line.trim() !== '' && /^\s/.test(line)) {
      current.text += ` ${line.trim()}`;
    } else if (line.trim() === '') {
      flush();
    }
  }
  flush();
  return entries;
}

function decisionIndex(lines) {
  const out = [];
  let lastSection = null;
  for (const e of bulletEntries(lines)) {
    if (!/^\*\*/.test(e.text) && !/^\d{4}-\d{2}-\d{2}/.test(e.text)) continue;
    const bold = /^\*\*(.+?)\*\*/.exec(e.text);
    let lead = oneLine(bold ? bold[1] : e.text);
    // A lead that is only an id ("req-21") says nothing: add what follows it.
    if (bold && /^req-\d+/i.test(lead) && lead.length <= 30) {
      const rest = oneLine(e.text.slice(bold[0].length)).replace(/^[—–:.\-\s]+/, '');
      if (rest) lead = `${lead} — ${rest}`;
    }
    const date = /\d{4}-\d{2}-\d{2}/.exec(e.text.slice(0, 320));
    if (e.section !== lastSection) {
      out.push(`\n### ${e.section}\n`);
      lastSection = e.section;
    }
    const shown = clip(lead.replace(/[.:;,]+$/, ''), MAX_LEAD);
    out.push(`- ${shown}${date && !shown.includes(date[0]) ? ` (${date[0]})` : ''}`);
  }
  return out.join('\n').trim();
}

function riskIndex(lines) {
  const body = section(lines, /^Open Risks/);
  if (!body) return '(section not found)';
  return bulletEntries(body.split('\n').map((l) => l))
    .map((e) => `- ${clip(oneLine(e.text), 140)}`)
    .join('\n');
}

// --- read -------------------------------------------------------------------
const rm = read('specs/roadmap.md').split('\n');
const dc = read('specs/decisions.md').split('\n');
const fm = read('specs/frontmatter-schema.md').split('\n');
const ts = read('specs/ticket-schema.md').split('\n');

const principles = section(rm, /^Core Architectural Principles/);
const techStack = section(rm, /^Tech Stack/);
const finishLine = section(rm, /^Finish line \(owner/);
for (const [name, v] of [['Core Architectural Principles', principles], ['Tech Stack', techStack], ['Finish line (owner …)', finishLine]]) {
  if (!v) {
    console.error(`gen-spec-digest: roadmap section "${name}" not found — the digest generator needs updating`);
    process.exit(2);
  }
}

const tsIntroEnd = ts.findIndex((l) => /^## Layout/.test(l));
const tsIntro = ts.slice(0, tsIntroEnd > 0 ? tsIntroEnd : 60).join('\n').trim();
const fmIntroEnd = fm.findIndex((l, i) => i > 0 && /^## /.test(l));
const fmIntro = fm.slice(0, fmIntroEnd > 0 ? fmIntroEnd : 6).join('\n').trim();

// --- assemble ---------------------------------------------------------------
const digest = `# Spec digest — read this instead of the four spec files

> **Generated** by \`node scripts/gen-spec-digest.mjs\` from \`specs/roadmap.md\`,
> \`decisions.md\`, \`frontmatter-schema.md\` and \`ticket-schema.md\`. Never edit by hand;
> \`--check\` (and \`check-specs.mjs\`) fail when it is stale. It carries **no line numbers
> and no status**, so it changes only when a principle, the finish line, a heading or a
> decision entry changes.

**What binds you.** The four files stay the binding specification. This digest is
what you read **first**: the fixed principles, the finish line that decides what may be
worked, and an index of every section and every excluded idea. Before you propose,
change or build something it touches, open the named section of the named file
(\`grep -n "<heading or lead>" specs/<file>\`; read the lines around the hit) — never the
whole file. Before you propose an idea, scan **Excluded ideas** below: anything listed
there is not to be re-proposed without the owner's new justification.

Open work and its order, the current status line and the next free ids are **not**
here: \`grep -n "^\\*\\*Status" specs/roadmap.md\`, then the section you need.

## Fixed principles (roadmap)

${principles}

## Tech stack (roadmap)

${techStack}

## Finish line (roadmap) — what may be worked now

${finishLine}

## Roadmap sections

${headingIndex(rm)}

## Open risks (roadmap, first line each)

${riskIndex(rm)}

## Excluded ideas and won't-dos (decisions)

One line per entry: its lead and the first date it names. Detail is one grep away.

${decisionIndex(dc)}

## Ticket schema (ticket-schema) — the top-level rules, verbatim

${tsIntro}

### Ticket-schema sections

${headingIndex(ts)}

## Frontmatter schema (frontmatter-schema)

${fmIntro}

${headingIndex(fm)}
`;

if (checkOnly) {
  const have = existsSync(outPath) ? readFileSync(outPath, 'utf8').replace(/\r\n/g, '\n') : null;
  if (have === digest) {
    console.log(`spec digest: up to date (${outPath})`);
    process.exit(0);
  }
  console.error(`ERROR spec digest: ${have === null ? 'missing' : 'stale'} — run: node scripts/gen-spec-digest.mjs`);
  process.exit(1);
}

writeFileSync(outPath, digest, 'utf8');
const bytes = Buffer.byteLength(digest, 'utf8');
const sources = [rm, dc, fm, ts].reduce((n, l) => n + Buffer.byteLength(l.join('\n'), 'utf8'), 0);
console.log(`spec digest written: ${outPath}`);
console.log(`  ${bytes} bytes (~${Math.round(bytes / 3.5)} tokens at 3.5 chars/token) vs ${sources} bytes in the four sources (${((bytes / sources) * 100).toFixed(1)} %)`);
