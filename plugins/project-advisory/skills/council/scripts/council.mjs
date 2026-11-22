#!/usr/bin/env node
// No static imports: they would load before this check and could fail on an old Node with a cryptic error.
const [major] = process.versions.node.split('.').map(Number);
if (major < 22) {
  console.error(`council needs Node.js 22 or newer (found ${process.versions.node}). Install it from https://nodejs.org/`);
  process.exit(1);
}

const { parseArgs } = await import('node:util');
const { COMMANDS } = await import('./commands.mjs');

const OPTIONS = {
  root: { type: 'string' },
  session: { type: 'string' },
  goal: { type: 'string' },
  url: { type: 'string' },
  data: { type: 'string' },
  budget: { type: 'string' },
  role: { type: 'string' },
  phase: { type: 'string' },
  stage: { type: 'string' },
  doc: { type: 'string' },
  key: { type: 'string' },
  value: { type: 'string' },
  by: { type: 'string' },
  source: { type: 'string' },
  confidence: { type: 'string' },
  reason: { type: 'string' },
  refresh: { type: 'string' },
  kind: { type: 'string' },
  pick: { type: 'string' },
  object: { type: 'string' },
  focus: { type: 'string' },
  correct: { type: 'string' },
  show: { type: 'boolean' },
  collect: { type: 'boolean' },
  force: { type: 'boolean' },
  abandon: { type: 'boolean' },
  save: { type: 'boolean' },
  html: { type: 'boolean' },
};

const [command, ...rest] = process.argv.slice(2);
const fn = COMMANDS[command];
if (!fn) {
  console.error(`Usage: ${process.env.COUNCIL_KIND ?? 'council'} <${Object.keys(COMMANDS).join('|')}> [--root <dir>] [--session <id>] [options]`);
  process.exit(2);
}

try {
  const { values } = parseArgs({ args: rest, options: OPTIONS, allowPositionals: false, strict: true });
  // The no-contact guard (hooks/ at the plugin's root): armed while a session runs, lifted when it is closed.
  const guard = await import('../../../hooks/guard.mjs').catch(() => null);
  guard?.arm({ root: values.root ?? process.cwd(), skill: values.kind ?? process.env.COUNCIL_KIND ?? 'council' });
  const result = await fn(values);
  if (command === 'close' && result?.ok !== false) guard?.disarm({ root: values.root ?? process.cwd() });
  if (typeof result === 'string') process.stdout.write(result.endsWith('\n') ? result : `${result}\n`);
  else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result && typeof result === 'object' && result.ok === false) process.exitCode = 1;
} catch (e) {
  console.error(`council: ${e.message}`);
  process.exitCode = 1;
}
