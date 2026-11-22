#!/usr/bin/env node
// The invention lab's entry point: the council's commands, run on the lab's sessions (.project-health/lab/). The lab is
// a skill of its own (skills/lab): it invents new things for the thing it is pointed at (a site, an app, a tool), and
// shares these scripts, the knowledge bank and the idea ledger with the council and the venture board.
process.env.COUNCIL_KIND = 'lab';
if (process.argv.length > 2 && !process.argv.includes('--kind')) process.argv.splice(3, 0, '--kind', 'lab');
await import('./council.mjs');
