import { defineConfig } from 'tgless/config';

// tgcloud has no environment variables at runtime, so values are inlined at build time.
// Keep real secrets out of git: export ADMIN_IDS=123,456 before `tgless build`.
export default defineConfig({
  define: {
    'process.env.ADMIN_IDS': JSON.stringify(process.env.ADMIN_IDS ?? '1'),
  },
});
