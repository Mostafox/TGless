#!/usr/bin/env node
import { main } from '../dist/cli/index.js';

main(process.argv.slice(2)).catch((err) => {
  console.error(err?.stack || err);
  process.exit(1);
});
