// BREACHLINE's entry program (Node 22, standard library only).
//
// The game itself is the game/ folder beside this file: plain static files a
// browser loads as ES modules, three.js 0.187.0 vendored under
// game/vendor/three/. This program hands the entry in — it copies game/ and
// screenshots/ into the output directory and writes dossier.json there with
// buildDossier from the kit's library (vendor/makefun-threejs.ts, unchanged),
// which is the exact text-and-images summary the judge reads.
//
// In the grader the output directory is /output; anywhere else,
// MAKEFUN_OUTPUT_DIR names it:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Play the game locally with `node serve.ts`, then http://localhost:8080.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// The caps below are the gate's own (see the kit's RULES.txt): the dossier
// text is cut at 160 KiB, screenshots are at most 4 files of 256 KiB, and
// game/ holds at most 993 entries and 48 MiB. buildDossier refuses anything
// over them, so an entry that builds here is an entry the gate can read.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  }),
);
