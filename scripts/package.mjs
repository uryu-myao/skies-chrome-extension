// Store and source packages, written to release/.
//
//   node scripts/package.mjs chrome           dist/chrome/  → release/skies-chrome-<version>.zip
//   node scripts/package.mjs firefox          dist/firefox/ → release/skies-firefox-<version>.zip
//   node scripts/package.mjs source [--dirty] git archive   → release/skies-<version>-source.zip
//
// Store packages are byte-for-byte reproducible: entries sorted by path, one
// fixed timestamp, no extra fields, so the same dist/ always zips the same.
// The source package is what AMO reviewers rebuild the Firefox package from
// (README-AMO.md).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const root = path.resolve(import.meta.dirname, '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const releaseDir = path.join(root, 'release');

// Never packaged: Finder metadata, AppleDouble files, source maps.
function isExcludedFromStorePackage(file) {
  const name = path.posix.basename(file);
  return name === '.DS_Store' || name.startsWith('._') || name.endsWith('.map');
}

// 1980-01-01 00:00, the earliest time a zip entry can hold. Every entry gets
// it, so the archive depends only on the files' paths and bytes.
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;

// A plain zip: no directory entries, no extra fields, deflate at level 9, or
// stored when deflate doesn't shrink the file.
function zip(entries) {
  const records = [];
  const directory = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const method = deflated.length < data.length ? 8 : 0;
    const body = method === 8 ? deflated : data;
    const crc = zlib.crc32(data);
    const flags = /^[\x20-\x7e]*$/.test(name) ? 0 : 0x0800; // bit 11: UTF-8 name

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed to extract: 2.0
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by: 2.0, MS-DOS attributes
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);

    records.push(local, nameBytes, body);
    directory.push(central, nameBytes);
    offset += local.length + nameBytes.length + body.length;
  }
  const centralDirectory = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...records, centralDirectory, end]);
}

function packageTarget(target) {
  const dir = path.join(root, 'dist', target);
  if (!fs.existsSync(path.join(dir, 'manifest.json'))) {
    throw new Error(`${path.relative(root, dir)}/ has no build — run npm run build:${target} first`);
  }
  const files = fs
    .readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .map((file) => file.split(path.sep).join('/'))
    .filter((file) => fs.statSync(path.join(dir, file)).isFile())
    .filter((file) => !isExcludedFromStorePackage(file))
    .sort();
  const out = path.join(releaseDir, `skies-${target}-${version}.zip`);
  fs.mkdirSync(releaseDir, { recursive: true });
  fs.writeFileSync(out, zip(files.map((name) => ({ name, data: fs.readFileSync(path.join(dir, name)) }))));
  console.log(`${path.relative(root, out)}  ${files.length} files, ${fs.statSync(out).size} bytes`);
}

// Left out of the source package. Only what building the extension (and its
// tests) needs goes to AMO.
const SOURCE_EXCLUDES = [
  'src/server', // a local Express backend the extension doesn't bundle
  'docs',
  'CLAUDE.md',
  'README.md',
  'eslint.config.js',
  '.gitignore',
];

function git(args, env = {}) {
  return execFileSync('git', args, { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' }).trim();
}

// The committed tree by default. --dirty snapshots the working tree (tracked
// and new files, .gitignore respected) into an unreferenced commit instead —
// for checking the package before committing, never for submitting.
function sourceCommit(dirty) {
  const changes = git(['status', '--porcelain']);
  if (!dirty) {
    if (changes) throw new Error('working tree has uncommitted changes; commit them, or pass --dirty for a trial package');
    return git(['rev-parse', 'HEAD']);
  }
  const indexDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skies-source-'));
  try {
    const env = { GIT_INDEX_FILE: path.join(indexDir, 'index') };
    git(['read-tree', 'HEAD'], env);
    git(['add', '-A'], env);
    const tree = git(['write-tree'], env);
    // HEAD's date, not now: the same working tree gives the same archive.
    const date = git(['log', '-1', '--format=%cI', 'HEAD']);
    return git(['commit-tree', tree, '-p', 'HEAD', '-m', 'package:source --dirty snapshot'], {
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    });
  } finally {
    fs.rmSync(indexDir, { recursive: true, force: true });
  }
}

function packageSource(dirty) {
  const commit = sourceCommit(dirty);
  const name = `skies-${version}-source${dirty ? '-dirty' : ''}`;
  const out = path.join(releaseDir, `${name}.zip`);
  fs.mkdirSync(releaseDir, { recursive: true });
  git([
    'archive',
    '--format=zip',
    `--prefix=${name}/`,
    '-o',
    out,
    commit,
    '--',
    '.',
    ...SOURCE_EXCLUDES.map((p) => `:(exclude)${p}`),
    ':(exclude,glob)**/.env*',
  ]);
  const listing = execFileSync('unzip', ['-Z1', out], { encoding: 'utf8' })
    .split('\n')
    .filter((line) => line && !line.endsWith('/'));
  console.log(`${path.relative(root, out)}  ${listing.length} files, ${fs.statSync(out).size} bytes, from ${commit.slice(0, 12)}`);
  if (dirty) console.log('--dirty: built from uncommitted changes — not for AMO submission');
  for (const file of listing) console.log(`  ${file}`);
}

const [what, ...flags] = process.argv.slice(2);
if (what === 'chrome' || what === 'firefox') packageTarget(what);
else if (what === 'source') packageSource(flags.includes('--dirty'));
else {
  console.error('usage: node scripts/package.mjs chrome|firefox|source [--dirty]');
  process.exit(1);
}
