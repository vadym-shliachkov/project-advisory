import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

export function hasCommand(cmd, args = ['--version']) {
  const r = spawnSync(cmd, args, { shell: process.platform === 'win32', stdio: 'ignore', timeout: 15000 });
  return r.status === 0;
}

// True only when root is the top level of its own repository. A folder inside a parent repository (for example
// a home-directory dotfiles repo) counts as not a git repo, so git commands never describe the parent.
export function isGitRepo(root) {
  const r = spawnSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (r.status !== 0 || !r.stdout.trim()) return false;
  const real = (p) => {
    const resolved = fs.realpathSync.native(p);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  try {
    return real(r.stdout.trim()) === real(root);
  } catch {
    return false;
  }
}
