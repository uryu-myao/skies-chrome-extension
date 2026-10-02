// Replaces public/flags/ with flagcdn.com's 80px-wide PNG flags — every flag
// in the pack, one xx.png per country code (plus a few territories and
// the UK's nations). The search shows them beside each result (spec §9.6).
//
//   node scripts/fetch-flags.mjs
//
// Needs network access and `unzip`. The PNGs are committed; building the
// extension never runs this. Source and terms: ATTRIBUTION.md.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const URL = 'https://flagcdn.com/w80.zip';
const out = path.join(root, 'public/flags');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skies-flags-'));
try {
  const response = await fetch(URL);
  if (!response.ok) throw new Error(`${URL}: HTTP ${response.status}`);
  const zip = path.join(dir, 'w80.zip');
  fs.writeFileSync(zip, Buffer.from(await response.arrayBuffer()));
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  execFileSync('unzip', ['-q', '-o', zip, '*.png', '-d', out]);
  const count = fs.readdirSync(out).filter((f) => f.endsWith('.png')).length;
  console.log(`public/flags/: ${count} flags from ${URL} (Last-Modified ${response.headers.get('last-modified')})`);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
