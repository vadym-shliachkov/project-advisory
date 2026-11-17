import fs from 'node:fs';
import path from 'node:path';

export const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'vendor', 'dist', 'build', 'out', '.next', '.nuxt', '.output', '.astro',
  '.svelte-kit', '.cache', 'coverage', '.project-health', '.vercel', '.netlify', 'wp-admin', 'wp-includes',
]);

export function listFiles(root, { maxFiles = 20000, maxDepth = 8 } = {}) {
  const out = [];
  const walk = (dir, rel, depth) => {
    if (depth > maxDepth || out.length >= maxFiles) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= maxFiles) return;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!IGNORE_DIRS.has(e.name)) walk(path.join(dir, e.name), childRel, depth + 1);
      } else if (e.isFile()) {
        out.push(childRel);
      }
    }
  };
  walk(root, '', 0);
  return out;
}
