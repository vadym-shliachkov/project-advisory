#!/usr/bin/env node
// The design studio's entry point: the council's commands, run on the studio's sessions (.project-health/studio/). The
// studio is a skill of its own (skills/studio): it looks for what a site could look, read and move like, and shares
// these scripts, the knowledge bank and the idea ledger with the council, the venture board and the invention lab.
process.env.COUNCIL_KIND = 'studio';
if (process.argv.length > 2 && !process.argv.includes('--kind')) process.argv.splice(3, 0, '--kind', 'studio');
await import('./council.mjs');
