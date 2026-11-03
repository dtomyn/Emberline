#!/usr/bin/env node
/**
 * The explainer film (film/storyboard.md), rendered frame by frame from the live app by film/render.py.
 * Runs that script with the IRISIdeas Python (playwright, imageio-ffmpeg, kokoro-onnx, soundfile, numpy),
 * which also speaks the narration. Output goes to data/film/ (gitignored).
 *
 * Usage: npm run film [-- --preview] [-- --stills 5,40] [-- --until 30] [-- --url https://…]
 * Environment: KOKORO_PYTHON and KOKORO_DIR, as for "npm run make:voice".
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const IRIS = 'C:\\DevSource\\IRISIdeas\\.venv';
const PYTHON = process.env.KOKORO_PYTHON ?? join(IRIS, process.platform === 'win32' ? 'Scripts\\python.exe' : 'bin/python');
if (!existsSync(PYTHON)) {
  console.error(`Python not found at ${PYTHON}. Set KOKORO_PYTHON to a Python with playwright, imageio-ffmpeg, kokoro-onnx, soundfile and numpy.`);
  process.exit(1);
}
// -I keeps the interpreter from loading modules from the working directory
const run = spawnSync(PYTHON, ['-I', resolve('film/render.py'), ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(run.status ?? 1);
