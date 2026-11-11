/**
 * OpenAPI document verification, run with the prepack validation check of the release chain: YAML can be parsed, all
 * $ref can be parsed, the path/operation/response meets the basic requirements of 3.1, and each path in the document
 * actually exists in the route implementation of the host side (to prevent document drift). It only does static
 * comparison, does not provide services, does not send requests, and does not verify the semantics of the sample
 * content. The path is always resolved from the location of this file instead of CWD: the document is at the warehouse
 * root, and this file is at dsh-pet/scripts/. MUST ALWAYS: Any failure ends with a non-zero exit code, and bad
 * documents cannot enter the release chain.
 * @module dsh-pet/scripts/check-openapi
 */
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

const HERE = dirname(fileURLToPath(import.meta.url)); // dsh-pet/scripts
const SPEC_PATH = join(HERE, '..', '..', 'openapi.yaml'); // Warehouse root
const ROUTES_DIR = join(HERE, '..', 'src', 'host', 'routes');

const doc = yaml.load(readFileSync(SPEC_PATH, 'utf8'));
const fail = [];
const ok = [];

if (doc.openapi !== '3.1.0') fail.push(`Expected OpenAPI 3.1.0; received ${doc.openapi}`);
else ok.push('openapi 3.1.0');
for (const key of ['info', 'paths', 'components', 'servers', 'tags']) {
  if (!doc[key]) fail.push(`Missing top-level field ${key}`);
}
if (!doc.info?.title || !doc.info?.version) fail.push('Missing info.title or info.version');

/** When parsing the reference in the document according to JSON Pointer (including ~1/~0 anti-escaping), undefined is returned if it cannot be parsed. */
const deref = (ref) => {
  if (!ref.startsWith('#/')) return undefined;
  let cur = doc;
  for (const seg of ref.slice(2).split('/')) {
    cur = cur?.[seg.replace(/~1/g, '/').replace(/~0/g, '~')];
    if (cur === undefined) return undefined;
  }
  return cur;
};
let refCount = 0;
/** Deeply traverse the document and verify that $ref can be parsed and counted one by one. */
const walk = (node, path) => {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}[${i}]`));
  for (const [k, v] of Object.entries(node)) {
    if (k === '$ref' && typeof v === 'string') {
      refCount++;
      if (deref(v) === undefined) fail.push(`Unresolved $ref: ${v} (at ${path})`);
    } else walk(v, `${path}.${k}`);
  }
};
walk(doc, '$');
ok.push(`All ${refCount} references resolve`);

const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace'];
let ops = 0;
for (const [p, item] of Object.entries(doc.paths)) {
  if (!p.startsWith('/dsh-pet-7340')) fail.push(`Path must start with /dsh-pet-7340: ${p}`);
  const keys = Object.keys(item).filter((k) => METHODS.includes(k));
  if (keys.length === 0) fail.push(`${p} has no operations`);
  for (const m of keys) {
    ops++;
    const op = item[m];
    if (!op.operationId) fail.push(`${m.toUpperCase()} ${p} is missing operationId`);
    if (!op.summary) fail.push(`${m.toUpperCase()} ${p} is missing summary`);
    if (!Array.isArray(op.tags) || !op.tags.length) fail.push(`${m.toUpperCase()} ${p} is missing tags`);
    else
      for (const t of op.tags) {
        if (!doc.tags.some((x) => x.name === t)) fail.push(`${m.toUpperCase()} ${p} uses undeclared tag ${t}`);
      }
    if (!op.responses || !Object.keys(op.responses).length) fail.push(`${m.toUpperCase()} ${p} is missing responses`);
    for (const [code, r] of Object.entries(op.responses ?? {})) {
      if (!/^[1-5](\d\d|XX)$/.test(code)) fail.push(`${m.toUpperCase()} ${p} has an invalid response code: ${code}`);
      if (!r.description && !r.$ref) fail.push(`${m.toUpperCase()} ${p} response ${code} is missing description`);
    }
    // The inline parameter must come with name/in, otherwise the route cannot be bound; the $ref parameter is submitted to the dangling reference check above.
    for (const prm of op.parameters ?? []) {
      if (prm.$ref === undefined && (!prm.name || !prm.in))
        fail.push(`${m.toUpperCase()} ${p} has a parameter without name/in`);
    }
  }
}
ok.push(`${Object.keys(doc.paths).length} paths / ${ops} operations`);

// The route of the host side is assigned to each field processor: forward matching or reverse guard, rest may be two
// segments (config/meta); the asset field is based on the first-level segment fallback, written `scope === 'x'` .
// Therefore, both sides are normalized into first-level segments and then compared, otherwise they will be false
// positives for each other. Scan processor by processor instead of just looking at the distributor: the distributor
// only lists the processors, and the segment names are in their respective files. Must be recursive: Domain processors
// are divided into subdirectories (such as routes/config /). Scanning only one level will miss the rest branch in the
// subdirectory, so "the document is present and the implementation is also there" is false positive as the
// implementation is missing.
const routeSources = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return routeSources(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
  });

const implemented = new Set();
for (const file of routeSources(ROUTES_DIR)) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/rest (?:===|!==) '([^']+)'/g)) implemented.add(m[1].split('/')[0]);
  // The asset field has both forward branches and reverse guards (`scope !== 'thumb'` is the thumb branch), both are considered.
  for (const m of src.matchAll(/scope (?:===|!==) '([^']+)'/g)) implemented.add(m[1]);
}
const documented = new Set();
for (const p of Object.keys(doc.paths)) {
  const seg = p.slice('/dsh-pet-7340/'.length).split('/')[0];
  if (seg && !seg.startsWith('{')) documented.add(seg);
}
for (const seg of documented) {
  if (!implemented.has(seg)) fail.push(`Documented route /${seg} has no host implementation`);
}
for (const seg of implemented) {
  if (!documented.has(seg)) fail.push(`Host route /${seg} is missing from the documentation`);
}
ok.push(`Routes aligned: ${[...documented].sort().join(', ')}`);

// Component schema either comes with its own type combination or references elsewhere, otherwise consumers cannot generate code based on it.
for (const [name, s] of Object.entries(doc.components.schemas)) {
  if (!s || typeof s !== 'object') fail.push(`Schema ${name} is not an object`);
  if (!s.type && !s.oneOf && !s.allOf && !s.anyOf && !s.$ref) fail.push(`Schema ${name} has no type or composition`);
}

console.log('Passed:');
for (const l of ok) console.log('  ✓ ' + l);
if (fail.length) {
  console.log('\nFailed:');
  for (const l of fail) console.log('  ✗ ' + l);
  process.exit(1);
}
console.log('\nAll OpenAPI validation checks passed.');
