#!/usr/bin/env node
// The venture board's entry point: the council's commands, run on the venture board's sessions (.project-health/venture/).
// The venture board is a skill of its own (skills/venture); it shares these scripts, the knowledge bank and the
// groundwork with the council and the invention lab.
process.env.COUNCIL_KIND = 'venture';
if (process.argv.length > 2 && !process.argv.includes('--kind')) process.argv.splice(3, 0, '--kind', 'venture');
await import('./council.mjs');
