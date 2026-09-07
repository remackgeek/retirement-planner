import { describe, it, expect } from 'vitest';
import {
  parseChangelog,
  compareSemver,
  unseenReleases,
  changelogMarkdownForApp,
  parsedChangelog,
} from './changelog';

const FIXTURE = `# Changelog

Intro.

## Unreleased

- not shipped yet

## 1.10.0 — 2026-09-01

- ten then nine

## v1.9.0 – 2026-08-01

- hyphen-ish dash
  - nested
- second bullet

## 1.0.0 - 2026-01-01

- initial
`;

describe('parseChangelog', () => {
  it('parses Unreleased plus released headings (em dash, en dash, hyphen, v prefix)', () => {
    const parsed = parseChangelog(FIXTURE);
    expect(parsed.unreleased).toBe('- not shipped yet');
    expect(parsed.releases.map((r) => r.version)).toEqual(['1.10.0', '1.9.0', '1.0.0']);
    expect(parsed.releases[0].date).toBe('2026-09-01');
    expect(parsed.releases[1].date).toBe('2026-08-01');
    expect(parsed.releases[1].body).toContain('nested');
    expect(parsed.releases[2].heading).toBe('## 1.0.0 - 2026-01-01');
  });

  it('skips malformed headings without throwing', () => {
    const parsed = parseChangelog(`# Changelog

## Not a version

- orphan

## 2.0.0 — 2026-09-03

- ok
`);
    expect(parsed.releases).toEqual([
      {
        version: '2.0.0',
        date: '2026-09-03',
        body: '- ok',
        heading: '## 2.0.0 — 2026-09-03',
      },
    ]);
  });

  it('handles CRLF and an empty Unreleased section', () => {
    const parsed = parseChangelog('# Changelog\r\n\r\n## Unreleased\r\n\r\n## 0.1.0 — 2026-05-01\r\n\r\n- hello\r\n');
    expect(parsed.unreleased).toBe('');
    expect(parsed.releases).toHaveLength(1);
    expect(parsed.releases[0].body).toBe('- hello');
  });

  it('returns empty releases for an empty file', () => {
    expect(parseChangelog('')).toEqual({ unreleased: '', releases: [] });
  });

  it('matches the Node parser on the same fixture', async () => {
    const node = await import('../../scripts/changelog-version.mjs');
    expect(node.parseChangelog(FIXTURE)).toEqual(parseChangelog(FIXTURE));
    expect(node.latestReleasedVersion(FIXTURE)).toBe('1.10.0');
    expect(node.unreleasedHasItems(FIXTURE)).toBe(true);
    expect(node.unreleasedHasItems('# Changelog\n\n## Unreleased\n\n## 1.0.0 — 2026-01-01\n\n- x\n')).toBe(false);
    expect(() => node.latestReleasedVersion('# Changelog\n')).toThrow(/no released/);
  });
});

describe('compareSemver', () => {
  it('orders 1.10.0 after 1.9.0', () => {
    expect(compareSemver('1.10.0', '1.9.0')).toBe(1);
    expect(compareSemver('1.9.0', '1.10.0')).toBe(-1);
    expect(compareSemver('1.9.0', '1.9.0')).toBe(0);
  });

  it('treats a non-semver string as less than a valid version', () => {
    expect(compareSemver('nope', '1.0.0')).toBe(-1);
    expect(compareSemver('1.0.0', 'nope')).toBe(1);
  });
});

describe('unseenReleases', () => {
  const releases = parseChangelog(FIXTURE).releases;

  it('returns versions after lastSeen and at most appVersion, newest first', () => {
    expect(unseenReleases(releases, '1.0.0', '1.9.0').map((r) => r.version)).toEqual(['1.9.0']);
    expect(unseenReleases(releases, '1.0.0', '1.10.0').map((r) => r.version)).toEqual([
      '1.10.0',
      '1.9.0',
    ]);
  });

  it('returns nothing when lastSeen equals appVersion', () => {
    expect(unseenReleases(releases, '1.10.0', '1.10.0')).toEqual([]);
  });

  it('hides a changelog heading newer than the running app', () => {
    expect(unseenReleases(releases, '1.0.0', '1.0.0').map((r) => r.version)).toEqual([]);
  });
});

describe('changelogMarkdownForApp', () => {
  it('drops Unreleased and versions newer than the app', () => {
    const md = changelogMarkdownForApp(parseChangelog(FIXTURE), '1.9.0');
    expect(md).not.toContain('# Changelog');
    expect(md).toContain('## v1.9.0');
    expect(md).toContain('## 1.0.0');
    expect(md).not.toContain('Unreleased');
    expect(md).not.toContain('1.10.0');
    expect(md).not.toContain('not shipped yet');
  });
});

describe('shipped CHANGELOG.md', () => {
  it('parses with a semver as the latest released version', () => {
    expect(parsedChangelog.releases.length).toBeGreaterThan(0);
    expect(parsedChangelog.releases[0].version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
