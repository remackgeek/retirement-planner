/**
 * In-app changelog parser. Heading grammar must stay in lockstep with
 * scripts/changelog-version.mjs — both are covered by changelog.test.ts.
 *
 * Released heading: `## <major>.<minor>.<patch> — YYYY-MM-DD`
 * (optional `v` prefix; em dash, en dash, or hyphen).
 * Malformed `##` headings are skipped; the parser never throws.
 */
import changelogMd from '../../CHANGELOG.md?raw';

export interface ChangelogRelease {
  version: string;
  date: string;
  body: string;
  heading: string;
}

export interface ParsedChangelog {
  unreleased: string;
  releases: ChangelogRelease[];
}

const RELEASE_HEADING =
  /^##\s+v?(\d+\.\d+\.\d+)\s*[—–-]\s*(\d{4}-\d{2}-\d{2})\s*$/;
const UNRELEASED_HEADING = /^##\s+Unreleased\s*$/i;
const ANY_H2 = /^##\s+.+$/;

function trimBody(s: string): string {
  return s.replace(/^\n+/, '').replace(/\n+$/, '');
}

export function parseChangelog(md: string): ParsedChangelog {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let unreleased = '';
  const releases: ChangelogRelease[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!ANY_H2.test(line)) {
      i += 1;
      continue;
    }
    const heading = line;
    i += 1;
    const bodyLines: string[] = [];
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

function semverParts(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = semverParts(a);
  const pb = semverParts(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

/** Releases newer than lastSeen and at most appVersion, preserving file order (newest first). */
export function unseenReleases(
  releases: ChangelogRelease[],
  lastSeen: string,
  appVersion: string,
): ChangelogRelease[] {
  return releases.filter(
    (r) =>
      compareSemver(r.version, lastSeen) > 0
      && compareSemver(r.version, appVersion) <= 0,
  );
}

/** Full history for Help → Changelog: drop Unreleased and any heading newer than the running app. */
export function changelogMarkdownForApp(
  parsed: ParsedChangelog,
  appVersion: string,
): string {
  const shipped = parsed.releases.filter(
    (r) => compareSemver(r.version, appVersion) <= 0,
  );
  const parts: string[] = [];
  for (const r of shipped) {
    parts.push(r.heading, '', r.body, '');
  }
  return `${parts.join('\n').trim()}\n`;
}

export const parsedChangelog: ParsedChangelog = parseChangelog(changelogMd);
