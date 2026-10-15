import { defineConfig } from 'tglessjs/config';

// Everything is optional. See AGENTS.md → "Configuration".
export default defineConfig({
  // entry: 'src/main.ts',
  // minify: false,
  // stubBuiltins: ['fs'],          // Node built-ins a dependency imports but never uses
  // alias: { path: 'path-browserify' },
  // define: { 'process.env.API_URL': JSON.stringify(process.env.API_URL ?? '') },
});
