/**
 * Relative import loop detection: The module diagram in src must not have loops.
 *
 * Why it is needed: This reconstruction split dispatchPetRoute into 10 route modules and apply into 8 assembly
 * modules. The number of modules has doubled, and the loops can no longer be seen with the human eye. The type check
 * will not report a loop (ESM allows loops, but the initialization timing is fragile), so a separate line must be
 * nailed.
 *
 * Only runtime edges are counted: `import type` and `export type ... from` are erased in the product and do not
 * constitute a runtime cycle, so they are not counted (it is harmless to write the type as a cycle).
 *
 * Usage: node scripts/check-import-cycles.mjs [--json ]
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const SRC = 'src';

/** Collect all .ts /.tsx under src */
function collect(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collect(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full.replace(/\\/g, '/'));
  }
  return out;
}

/**
 * A file's runtime relative dependency.
 * @param file - Source file path.
 * @returns target file path list (only relative imports within src that are parsed).
 */
function edgesOf(file) {
  const text = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const out = [];
  const push = (spec, typeOnly) => {
    if (typeOnly || !spec.startsWith('.')) return;
    const abs = path.resolve(path.dirname(file), spec).replace(/\\/g, '/');
    const rel = path.relative(process.cwd(), abs).replace(/\\/g, '/');
    if (rel.endsWith('.ts') || rel.endsWith('.tsx')) out.push(rel);
  };
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      const clause = st.importClause;
      // The import statement of the overall type-only (import type { X } from '...') does not generate a runtime edge
      push(st.moduleSpecifier.text, Boolean(clause && clause.isTypeOnly));
    } else if (ts.isExportDeclaration(st) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
      push(st.moduleSpecifier.text, st.isTypeOnly);
    }
  }
  return out;
}

const files = collect(SRC);
const graph = new Map(files.map((f) => [f, edgesOf(f).filter((t) => files.includes(t))]));

/** Three colors DFS: gray = on the current stack, a ring is formed when a gray edge is encountered */
const WHITE = 0;
const GRAY = 1;
const BLACK = 2;
const color = new Map(files.map((f) => [f, WHITE]));
const stack = [];
const cycles = [];

function visit(node) {
  color.set(node, GRAY);
  stack.push(node);
  for (const next of graph.get(node) ?? []) {
    if (color.get(next) === GRAY) {
      const start = stack.indexOf(next);
      cycles.push([...stack.slice(start), next]);
    } else if (color.get(next) === WHITE) {
      visit(next);
    }
  }
  stack.pop();
  color.set(node, BLACK);
}

for (const f of files) if (color.get(f) === WHITE) visit(f);

if (process.argv.includes('--json')) {
  console.log(
    JSON.stringify(
      { files: files.length, edges: [...graph.values()].reduce((n, l) => n + l.length, 0), cycles },
      null,
      2,
    ),
  );
} else if (cycles.length === 0) {
  console.log(
    `[check-import-cycles] OK: ${files.length} modules, ${[...graph.values()].reduce((n, l) => n + l.length, 0)} runtime edges, no cycles`,
  );
} else {
  console.error(`[check-import-cycles] Found ${cycles.length} import cycles:`);
  for (const cycle of cycles) {
    console.error('  ' + cycle.map((f) => path.relative(process.cwd(), f)).join(' -> '));
  }
  process.exit(1);
}
