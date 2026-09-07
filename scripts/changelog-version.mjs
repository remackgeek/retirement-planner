/**
 * Node-side changelog parser. Heading grammar must stay in lockstep with
 * src/utils/changelog.ts — both are covered by changelog.test.ts.
 *
 * Released heading: `## <major>.<minor>.<patch> — YYYY-MM-DD`
 * (optional `v` prefix; em dash, en dash, or hyphen).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RELEASE_HEADING =
  /^##\s+v?(\d+\.\d+\.\d+)\s*[—–-]\s*(\d{4}-\d{2}-\d{2})\s*$/;
const UNRELEASED_HEADING = /^##\s+Unreleased\s*$/i;
const ANY_H2 = /^##\s+.+$/;
const LIST_ITEM = /^(?:\s*[-*+]\s+\S|\s*\d+\.\s+\S)/m;

function trimBody(s) {
  return s.replace(/^\n+/, '').replace(/\n+$/, '');
}

export function parseChangelog(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let unreleased = '';
  const releases = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!ANY_H2.test(line)) {
      i += 1;
      continue;
    }
    const heading = line;
    i += 1;
    const bodyLines = [];
    while (i < lines.length && !ANY_H2.test(lines[i])) {
      bodyLines.push(lines[i]);
      i += 1;
    }
    const body = trimBody(bodyLines.join('\n'));
    if (UNRELEASED_HEADING.test(heading)) {
      unreleased = body;
      continue;
    }
    const m = heading.match(RELEASE_HEADING);
    if (!m) continue;
    releases.push({ version: m[1], date: m[2], body, heading });
  }
  return { unreleased, releases };
}

export function readChangelog(root = process.cwd()) {
  return readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8');
}

export function latestReleasedVersion(md = readChangelog()) {
  const { releases } = parseChangelog(md);
  if (releases.length === 0) {
    throw new Error('CHANGELOG.md has no released ## x.y.z heading');
  }
  return releases[0].version;
}

export function notesFor(version, md = readChangelog()) {
  const { releases } = parseChangelog(md);
  const release = releases.find((r) => r.version === version);
  if (!release) {
    throw new Error(`CHANGELOG.md has no heading for version ${version}`);
  }
  return `${release.heading}\n\n${release.body}\n`;
}

export function unreleasedHasItems(md = readChangelog()) {
  const { unreleased } = parseChangelog(md);
  return LIST_ITEM.test(unreleased);
}
