import fs from 'node:fs';
import path from 'node:path';

// What kind of thing the invention lab works on. An invention for a website is not an invention for a command-line
// tool: the kind decides what the anatomist looks at, what counts as the standard kit of its genre, and how a surviving
// invention is sketched (a screen, or a terminal or code transcript). The script guesses the kind from the project's
// files and the address it was given; the anatomist confirms or corrects it, and the person can name it at the start.

export const OBJECT_KINDS = ['website', 'web-app', 'mobile-app', 'desktop-app', 'cli', 'library', 'api', 'extension', 'plugin', 'game', 'other'];
export const OBJECT_WORDS = {
  website: 'a website', 'web-app': 'a web application', 'mobile-app': 'a mobile app', 'desktop-app': 'a desktop application', cli: 'a command-line tool',
  library: 'a library or SDK', api: 'an API or service', extension: 'a browser extension', plugin: 'a plugin, skill or add-on for another tool', game: 'a game', other: 'a thing of its own kind',
};
// What a surviving invention is drawn as: a screen for things people look at, a transcript for things they type into
// or call from code.
export const SCREEN_KINDS = ['website', 'web-app', 'mobile-app', 'desktop-app', 'extension', 'game'];
export const sketchFormFor = (kind) => (SCREEN_KINDS.includes(kind) ? 'screen' : ['cli', 'plugin'].includes(kind) ? 'terminal' : kind === 'other' ? 'screen' : 'code');

const SKIP = new Set(['node_modules', '.git', '.project-health', 'dist', 'build', '.next', 'vendor', 'target', '.venv', 'venv', '__pycache__']);
const readText = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
const readJsonFile = (file) => { const t = readText(file); if (t === null) return null; try { return JSON.parse(t); } catch { return null; } };

// The files of the project, two levels deep, without the folders nobody writes by hand.
function listFiles(root, depth = 2) {
  const out = [];
  const walk = (dir, level) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue;
      const rel = path.relative(root, path.join(dir, e.name)).split(path.sep).join('/');
      if (e.isDirectory()) { out.push(`${rel}/`); if (level < depth) walk(path.join(dir, e.name), level + 1); } else out.push(rel);
      if (out.length > 4000) return;
    }
  };
  walk(root, 0);
  return out;
}

const WEB_FRAMEWORKS = ['next', 'nuxt', '@remix-run/react', '@sveltejs/kit', 'astro', 'gatsby', 'vite', 'react-scripts', '@angular/core', 'vue', 'svelte', 'react', 'eleventy', '@11ty/eleventy', 'hugo'];
const APP_SIGNS = ['next-auth', '@auth/core', '@supabase/supabase-js', 'firebase', 'prisma', '@prisma/client', 'drizzle-orm', 'mongoose', 'stripe', '@clerk/nextjs', 'socket.io', 'trpc', '@trpc/server', 'zustand', 'redux', '@reduxjs/toolkit', '@tanstack/react-query'];
const SERVER_SIGNS = ['express', 'fastify', 'koa', 'hono', '@nestjs/core', '@hapi/hapi', 'restify', 'apollo-server', '@apollo/server', 'graphql-yoga'];
const GAME_SIGNS = ['phaser', 'pixi.js', 'three', 'babylonjs', '@babylonjs/core', 'excalibur', 'kaboom', 'kaplay', 'playcanvas'];
const CLI_SIGNS = ['commander', 'yargs', 'oclif', '@oclif/core', 'cac', 'meow', 'clipanion', 'citty'];

// The kind, how sure the guess is, and what it rests on.
export function detectObject(root, { url = null } = {}) {
  const files = listFiles(root);
  const has = (rel) => files.includes(rel);
  const any = (re) => files.some((f) => re.test(f));
  const signals = [];
  const pick = (kind, why, confidence = 'high') => ({ kind, confidence, signals: [...signals, why] });

  // A plugin or skill for another tool, and a browser extension, say so in a manifest.
  if (has('.claude-plugin/plugin.json') || has('.codex-plugin/plugin.json') || any(/(^|\/)SKILL\.md$/) || has('.claude-plugin/marketplace.json')) return pick('plugin', 'a plugin manifest or SKILL.md files');
  const manifest = readJsonFile(path.join(root, 'manifest.json'));
  if (manifest?.manifest_version) return pick('extension', 'manifest.json with a manifest_version (a browser extension)');
  if (has('project.godot') || has('ProjectSettings/ProjectVersion.txt') || any(/\.uproject$/)) return pick('game', 'a game engine project');
  if (has('pubspec.yaml') || has('android/') || has('ios/') || any(/\.xcodeproj\/$/)) return pick('mobile-app', 'a mobile project (Flutter, Android or iOS folders)');
  if (has('src-tauri/')) return pick('desktop-app', 'a Tauri desktop project');
  if (has('wp-config.php') || has('wp-content/')) return pick('website', 'a WordPress site');

  const pkg = readJsonFile(path.join(root, 'package.json'));
  if (pkg) {
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}), ...(pkg.peerDependencies ?? {}) };
    const uses = (list) => list.filter((d) => Object.hasOwn(deps, d));
    if (uses(['react-native', 'expo']).length) return pick('mobile-app', `package.json uses ${uses(['react-native', 'expo']).join(', ')}`);
    if (uses(['electron']).length) return pick('desktop-app', 'package.json uses electron');
    if (uses(GAME_SIGNS).length) return pick('game', `package.json uses ${uses(GAME_SIGNS).join(', ')}`);
    const web = uses(WEB_FRAMEWORKS);
    const app = uses(APP_SIGNS);
    const server = uses(SERVER_SIGNS);
    if (web.length && app.length) return pick('web-app', `package.json uses ${web[0]} with ${app.slice(0, 3).join(', ')}`);
    if (web.length) return pick('website', `package.json uses ${web[0]}${url ? ', and the project has an address' : ''}`, url ? 'high' : 'low');
    if (server.length) return pick('api', `package.json uses ${server.join(', ')} and no front end`);
    if (pkg.bin || uses(CLI_SIGNS).length) return pick('cli', pkg.bin ? 'package.json has a "bin" entry' : `package.json uses ${uses(CLI_SIGNS).join(', ')}`);
    if (pkg.main || pkg.exports || pkg.module) return pick('library', 'package.json exports a module and runs no app');
    signals.push('package.json without a clear sign of its kind');
  }

  const cargo = readText(path.join(root, 'Cargo.toml'));
  if (cargo) {
    if (/\[\[bin\]\]/.test(cargo) || has('src/main.rs')) return pick('cli', 'a Rust crate with a binary');
    return pick('library', 'a Rust library crate');
  }
  const py = readText(path.join(root, 'pyproject.toml')) ?? readText(path.join(root, 'setup.cfg')) ?? readText(path.join(root, 'requirements.txt'));
  if (py) {
    if (/\bdjango\b/i.test(py)) return pick('web-app', 'a Django project');
    if (/\b(fastapi|flask|starlette|aiohttp)\b/i.test(py)) return pick('api', 'a Python web service');
    if (/\[project\.scripts\]|console_scripts|\b(click|typer|argparse)\b/i.test(py)) return pick('cli', 'a Python project with command-line scripts');
    if (/\b(pygame|arcade)\b/i.test(py)) return pick('game', 'a Python game');
    return pick('library', 'a Python package', 'low');
  }
  const gomod = readText(path.join(root, 'go.mod'));
  if (gomod) {
    if (/spf13\/cobra|urfave\/cli/.test(gomod)) return pick('cli', 'a Go command-line tool');
    if (/gin-gonic|labstack\/echo|gofiber|go-chi/.test(gomod)) return pick('api', 'a Go web service');
    return pick('library', 'a Go module', 'low');
  }
  if (any(/\.html?$/i)) return pick('website', 'HTML pages in the project');
  if (url) return pick('website', 'only an address was given', 'low');
  return { kind: 'other', confidence: 'low', signals: [...signals, 'nothing in the project says what kind of thing it is'] };
}

// The commit the project is at, read from the files of its git folder so no program is run. The lab reuses an anatomy
// only while the project has not changed.
export function gitHead(root) {
  const head = readText(path.join(root, '.git', 'HEAD'))?.trim();
  if (!head) return null;
  const ref = /^ref:\s*(.+)$/.exec(head)?.[1];
  if (!ref) return /^[0-9a-f]{40}$/i.test(head) ? head : null;
  const loose = readText(path.join(root, '.git', ...ref.split('/')))?.trim();
  if (loose) return loose;
  const packed = readText(path.join(root, '.git', 'packed-refs')) ?? '';
  return packed.split(/\r?\n/).map((l) => l.split(' ')).find(([, name]) => name === ref)?.[0] ?? null;
}
