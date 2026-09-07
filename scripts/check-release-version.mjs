#!/usr/bin/env node
/**
 * Master-deploy gate. Fails if CHANGELOG.md has no released heading or if
 * ## Unreleased still has list items. Prints the latest version to stdout.
 * Optional: --notes-file <path> writes that version's notes for gh release.
 */
import { writeFileSync } from 'node:fs';
import {
  latestReleasedVersion,
  notesFor,
  readChangelog,
  unreleasedHasItems,
} from './changelog-version.mjs';

const args = process.argv.slice(2);
let notesFile = null;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--notes-file') {
    notesFile = args[i + 1];
    if (!notesFile) {
      console.error('check-release-version: --notes-file requires a path');
      process.exit(1);
    }
    i += 1;
  }
}

const md = readChangelog();

if (unreleasedHasItems(md)) {
  console.error(
    'CHANGELOG.md ## Unreleased still has items. Promote them to a ## x.y.z heading before merging to master.',
  );
  process.exit(1);
}

let version;
try {
  version = latestReleasedVersion(md);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

if (notesFile) {
  writeFileSync(notesFile, notesFor(version, md), 'utf8');
}

process.stdout.write(`${version}\n`);
