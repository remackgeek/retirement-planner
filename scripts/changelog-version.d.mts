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

export function parseChangelog(md: string): ParsedChangelog;
export function readChangelog(root?: string): string;
export function latestReleasedVersion(md?: string): string;
export function notesFor(version: string, md?: string): string;
export function unreleasedHasItems(md?: string): boolean;
