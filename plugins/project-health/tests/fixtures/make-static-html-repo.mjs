import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'static-html');
const GIT_ID = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', '-c', 'commit.gpgsign=false'];

// Assembled at runtime so no secret-shaped string is committed to this repository.
export const FAKE_AWS_KEY = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');

function git(dir, ...args) {
  execFileSync('git', ['-C', dir, ...GIT_ID, ...args], { stdio: 'pipe' });
}

function commit(dir, message) {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
}

export function makeStaticHtmlRepo(target) {
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(FIXTURE, target, { recursive: true });
  git(target, 'init', '-q', '-b', 'main');
  commit(target, 'Initial site');
  fs.writeFileSync(path.join(target, '.env.production'), `AWS_ACCESS_KEY_ID=${FAKE_AWS_KEY}\nAPI_SECRET="fixture-only-not-a-secret-1234"\n`);
  commit(target, 'Add production config');
  fs.mkdirSync(path.join(target, 'pages'), { recursive: true });
  for (const name of ['services', 'team', 'pricing']) {
    fs.writeFileSync(path.join(target, 'pages', `${name}.html`), `<!doctype html>\n<html lang="en"><head><title>${name} | Acme Studio</title></head><body><h1>${name}</h1></body></html>\n`);
    fs.appendFileSync(path.join(target, 'index.html'), `<!-- nav: ${name} -->\n`);
    commit(target, `add page ${name}`);
  }
  return target;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: node make-static-html-repo.mjs <target-dir>');
    process.exit(2);
  }
  console.log(makeStaticHtmlRepo(path.resolve(target)));
}
