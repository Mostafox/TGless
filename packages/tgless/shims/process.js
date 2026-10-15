// Injected by tgless when bundled code references the global `process`.
const nextTick = (fn, ...args) => Promise.resolve().then(() => fn(...args));
export const process = globalThis.process ?? {
  env: { NODE_ENV: 'production' },
  argv: [],
  browser: true,
  version: '',
  versions: {},
  platform: 'tgcloud',
  nextTick,
  cwd: () => '/',
  on() {},
  emitWarning() {},
};
