/**
 * Run the derived street-label pass over the freshly exported segments.
 *
 * This exists because `export-static` rewrites segments.geojson from the
 * database on every run, which drops the `nd` labels and the `roadNames`
 * lookup — 26,727 segments silently revert to «شارع بلا اسم». Chaining the two
 * as an npm script is the obvious fix, but the interpreter path differs by
 * platform and npm hands the command to cmd.exe on Windows, where a
 * forward-slash path fails with "'research' is not recognized". Resolving the
 * interpreter here keeps one command that works everywhere.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'research', 'derive_segment_labels.py');

const candidates = process.platform === 'win32'
  ? [path.join(ROOT, 'research', '.venv', 'Scripts', 'python.exe')]
  : [path.join(ROOT, 'research', '.venv', 'bin', 'python3'),
     path.join(ROOT, 'research', '.venv', 'bin', 'python')];

const python = candidates.find((p) => existsSync(p));
if (!python) {
  console.error(
    `no interpreter found. Looked for:\n  ${candidates.join('\n  ')}\n` +
    'Create it with: python -m venv research/.venv && ' +
    'research/.venv/Scripts/pip install numpy scipy',
  );
  process.exit(1);
}

execFileSync(python, [SCRIPT], { stdio: 'inherit', cwd: ROOT });
