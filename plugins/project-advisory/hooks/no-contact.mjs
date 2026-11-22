#!/usr/bin/env node
// The no-contact hook (PreToolUse). It refuses a tool call that would submit a form, send a message or a post, notify
// someone or otherwise send something to a site: always inside the plugin's own subagents, and in any session while a
// skill of the plugin is running (see guard.mjs). Anything it cannot read, it lets through to the normal permissions.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toolReason, isOurAgent } from './rules.mjs';
import { armedState } from './guard.mjs';

let input;
try { input = JSON.parse(fs.readFileSync(0, 'utf8')); } catch { process.exit(0); }

const ours = isOurAgent(input.agent_type);
const state = ours ? null : armedState({ cwd: input.cwd || process.cwd() });
if (!ours && !state) process.exit(0);

let reason = null;
try { reason = toolReason(input.tool_name, input.tool_input ?? {}); } catch { reason = null; }
if (!reason) process.exit(0);

const guardCli = path.join(path.dirname(fileURLToPath(import.meta.url)), 'guard.mjs');
const why = ours
  ? `Refused by the project-advisory no-contact guard: ${reason}. Agents of this plugin never submit forms, send anything to a site or contact anyone. Do the turn without it; if something can only be found out by asking someone, say what is unknown and who could answer.`
  : `Refused by the project-advisory no-contact guard (armed by the ${state.skill} skill until ${new Date(state.until).toLocaleTimeString()}): ${reason}. While a skill of this plugin runs, nothing is sent to a site and nobody is contacted. Do not try another way. If the person wants this done, tell them: they can do it themselves, or lift the guard by running \`node "${guardCli}" off\` in their own terminal.`;

process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: why } }));
