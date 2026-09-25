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

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? '')) {
  console.error('Usage: npm run version:set <major.minor.patch>');
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
