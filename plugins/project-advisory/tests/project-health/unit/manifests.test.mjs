import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { readJson, REPO_ROOT, PLUGIN_ROOT } from '../helpers.mjs';

test('claude marketplace entry points at the plugin folder', () => {
  const m = readJson(path.join(REPO_ROOT, '.claude-plugin', 'marketplace.json'));
  const entry = m.plugins.find((p) => p.name === 'project-advisory');
  assert.ok(entry, 'project-advisory entry missing');
  assert.ok(fs.existsSync(path.join(REPO_ROOT, entry.source, '.claude-plugin', 'plugin.json')));
});

test('codex marketplace entry points at the plugin folder', () => {
  const m = readJson(path.join(REPO_ROOT, '.agents', 'plugins', 'marketplace.json'));
  const entry = m.plugins.find((p) => p.name === 'project-advisory');
  assert.ok(entry, 'project-advisory entry missing');
  assert.equal(entry.source.source, 'local');
  assert.match(entry.source.path, /^\.\//);
  assert.ok(fs.existsSync(path.join(REPO_ROOT, entry.source.path, '.codex-plugin', 'plugin.json')));
});

test('manifests and package.json agree on name and version', () => {
  const claude = readJson(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'));
  const codex = readJson(path.join(PLUGIN_ROOT, '.codex-plugin', 'plugin.json'));
  const pkg = readJson(path.join(PLUGIN_ROOT, 'package.json'));
  assert.equal(claude.name, 'project-advisory');
  assert.equal(codex.name, 'project-advisory');
  assert.equal(claude.version, pkg.version);
  assert.equal(codex.version, pkg.version);
  assert.equal(codex.skills, './skills/');
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}), [], 'no runtime dependencies allowed');
});
