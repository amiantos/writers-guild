/**
 * Set Writers Guild's version everywhere it's recorded: the root, server, and
 * client package.json files, and the root package-lock.json.
 *
 *   npm run version:set 1.1.0
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];

// Semantic Versioning 2.0.0's own pattern (semver.org): no leading zeros, no empty identifiers,
// and optional prerelease and build metadata.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

if (!SEMVER.test(version ?? '')) {
  console.error('Usage: npm run version:set <version>, a semantic version such as 1.2.0');
  process.exit(1);
}

function update(file, apply) {
  const fullPath = path.join(root, file);
  const json = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  apply(json);
  fs.writeFileSync(fullPath, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`${file}: ${version}`);
}

for (const file of ['package.json', 'server/package.json', 'vue_client/package.json']) {
  update(file, (json) => {
    json.version = version;
  });
}
update('package-lock.json', (json) => {
  json.version = version;
  json.packages[''].version = version;
});
