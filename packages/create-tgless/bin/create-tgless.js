#!/usr/bin/env node
// npm create tgless@latest <dir>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'template');
/** npm strips dotfiles named .gitignore from packages, so they ship without the dot. */
const RENAME = { gitignore: '.gitignore' };

const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) {
  console.log('Usage: npm create tgless@latest <project-dir>');
  process.exit(0);
}
const target = args.find((a) => !a.startsWith('-')) ?? 'my-bot';
const dest = path.resolve(target);
const name = path
  .basename(dest)
  .toLowerCase()
  .replace(/[^a-z0-9-_.]/g, '-');

if (fs.existsSync(dest) && fs.readdirSync(dest).length) {
  console.error(`✖ ${target} exists and is not empty.`);
  process.exit(1);
}

function copy(src, dst) {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dst, RENAME[entry.name] ?? entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      copy(from, to);
    } else {
      const text = fs.readFileSync(from, 'utf8').replaceAll('__NAME__', name);
      fs.writeFileSync(to, text);
    }
  }
}

fs.mkdirSync(dest, { recursive: true });
copy(TEMPLATE, dest);

const rel = path.relative(process.cwd(), dest) || '.';
console.log(`
✔ Created ${name} in ${rel}

Next steps:
  cd ${rel}
  npm install
  npx tgcloud login      # link this folder to your bot (see core.telegram.org/bots/serverless)
  npm run deploy         # build + push
  npm run migrate        # create the database tables

AI agents: read AGENTS.md first.
`);
