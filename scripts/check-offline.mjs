// Fails if a built package could reach the network — the extension makes no
// requests at all (spec §6.3), which is why Firefox's
// data_collection_permissions is "none".
//
//   node scripts/check-offline.mjs [chrome|firefox …]   default: both
//
// 1. Every http(s) or ws(s) URL in a text file of dist/<target>/ has to be on
//    ALLOWED below — links the user opens, license texts, and names that are
//    never requested. Anything else fails, flagcdn and Google Fonts included.
// 2. The JavaScript may call fetch() exactly once: in Vite's modulepreload
//    polyfill, which fetches only the <link rel="modulepreload"> hrefs Vite
//    writes — the extension's own chunks. XMLHttpRequest, sendBeacon,
//    WebSocket, EventSource and importScripts may not appear at all.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

const ALLOWED = [
  // Links the user opens from Settings → About (and the uninstall survey).
  [/^https:\/\/chromewebstore\.google\.com\//, 'Chrome Web Store listing — Share, Rate'],
  [/^https:\/\/addons\.mozilla\.org\//, 'Firefox Add-ons listing'],
  [/^https:\/\/useskies\.com\/?$/, 'Website'],
  [/^https:\/\/forms\.gle\//, 'Send Feedback; the uninstall survey'],
  [/^https:\/\/(www\.)?geonames\.org\/?$/, 'City data credit'],
  // License texts and links.
  [/^https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/$/, 'CC BY 4.0 — City data credit'],
  [/^http:\/\/scripts\.sil\.org\/OFL$/, 'SIL Open Font License, in fonts/OFL-*.txt'],
  [/^https:\/\/github\.com\/itfoundry\/Poppins$/, "Poppins' copyright line, in fonts/OFL-Poppins.txt"],
  // Names, never requested.
  [/^http:\/\/www\.w3\.org\/(2000\/svg|1999\/xhtml|1999\/xlink|1998\/Math\/MathML|XML\/1998\/namespace)$/, 'XML namespace names (SVG icons, react-dom)'],
  [/^https:\/\/reactjs\.org\/docs\/error-decoder\.html\?invariant=$/, "part of react-dom's production error messages"],
];

const TEXT = /\.(js|mjs|css|html|json|svg|txt|md)$/;
const URL_PATTERN = /\b(?:https?|wss?):\/\/[^\s"'`<>()\\]+/g;
const FORBIDDEN_APIS = ['XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource', 'importScripts'];

function check(target) {
  const dir = path.join(root, 'dist', target);
  if (!fs.existsSync(path.join(dir, 'manifest.json'))) throw new Error(`dist/${target}/ has no build`);
  const problems = [];
  let fetchCalls = 0;
  const files = fs
    .readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => TEXT.test(file) && fs.statSync(path.join(dir, file)).isFile())
    .sort();
  for (const file of files) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const [url] of text.matchAll(URL_PATTERN)) {
      if (!ALLOWED.some(([pattern]) => pattern.test(url))) problems.push(`${file}: URL not on the allowlist: ${url}`);
    }
    if (!file.endsWith('.js')) continue;
    for (const api of FORBIDDEN_APIS) {
      if (text.includes(api)) problems.push(`${file}: uses ${api}`);
    }
    for (const match of text.matchAll(/\bfetch\s*\(/g)) {
      fetchCalls++;
      const before = text.slice(Math.max(0, match.index - 600), match.index);
      if (!before.includes('modulepreload')) problems.push(`${file}: fetch() outside Vite's modulepreload polyfill`);
    }
  }
  if (fetchCalls > 1) problems.push(`${fetchCalls} fetch() calls — only the modulepreload polyfill's one is allowed`);
  return { files: files.length, problems };
}

const targets = process.argv.slice(2).length ? process.argv.slice(2) : ['chrome', 'firefox'];
let failed = false;
for (const target of targets) {
  const { files, problems } = check(target);
  if (problems.length) {
    failed = true;
    console.error(`check:offline — dist/${target}/: ${problems.length} problem(s)`);
    for (const problem of problems) console.error(`  ${problem}`);
  } else {
    console.log(`check:offline — dist/${target}/: ${files} text files, no network access`);
  }
}
if (failed) process.exit(1);
