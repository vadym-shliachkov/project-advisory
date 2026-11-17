import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = path.resolve(PLUGIN_ROOT, '..', '..');
export const SKILL_DIR = path.join(PLUGIN_ROOT, 'skills', 'council');

export const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
// Each test's own folder is removed when its test file ends; only folders made here are removed.
const made = [];
process.on('exit', () => { for (const dir of made) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* still open: left for the OS */ } } });
export const tmpDir = (prefix = 'council-test-') => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); made.push(dir); return dir; };
