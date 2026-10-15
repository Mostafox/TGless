import path from 'node:path';
import { createRequire } from 'node:module';
import type { Plugin } from 'esbuild';

const require = createRequire(import.meta.url);

/** Node built-ins with a browser polyfill we can bundle. */
const POLYFILLS: Record<string, string> = {
  buffer: 'buffer/',
  events: 'events/',
};

/** Built-ins that are safe to replace with an empty module (rarely used at runtime). */
const EMPTY = new Set(['fs', 'fs/promises', 'path', 'os', 'tty', 'child_process', 'net', 'tls', 'http', 'https', 'zlib', 'crypto', 'stream', 'util', 'url', 'worker_threads', 'module', 'perf_hooks', 'async_hooks', 'dns', 'http2', 'vm', 'readline', 'cluster', 'dgram', 'inspector', 'v8', 'string_decoder', 'assert', 'querystring', 'process', 'constants', 'timers', 'diagnostics_channel']);

const BUILTINS = new Set([...Object.keys(POLYFILLS), ...EMPTY]);

/** `node_modules/@scope/pkg/x.js` → `@scope/pkg`. */
export function packageOf(file: string | undefined): string | undefined {
  if (!file) return undefined;
  const parts = file.split(/[\\/]/);
  const i = parts.lastIndexOf('node_modules');
  if (i < 0) return undefined;
  return parts[i + 1]?.startsWith('@') ? `${parts[i + 1]}/${parts[i + 2]}` : parts[i + 1];
}

export interface PlatformPluginOptions {
  /** Polyfill/stub Node built-ins (true) or fail on all of them (false). */
  polyfills: boolean;
  /** Built-ins the user explicitly allowed to be stubbed with an empty module. */
  allowEmpty?: string[];
  /** Collected problems (instead of failing the first one). */
  problems: { pkg: string; builtin: string; importer: string }[];
}

/**
 * Enforces tgcloud's module rules while bundling:
 *  - `sdk`, `sdk/*` and `../schema.js` stay as imports (they exist on the platform);
 *  - Node built-ins are polyfilled (buffer, events) or reported with the package that needs them.
 */
export function platformPlugin(opts: PlatformPluginOptions): Plugin {
  return {
    name: 'tgless-platform',
    setup(build) {
      build.onResolve({ filter: /^sdk(\/.*)?$/ }, (args) => ({ path: args.path, external: true }));
      build.onResolve({ filter: /^\.\.\/schema\.js$/ }, (args) =>
        args.importer.endsWith('tgless-entry.js') || args.importer === '<stdin>' ? { path: '../schema.js', external: true } : undefined,
      );
      build.onResolve({ filter: /^(node:)?[a-z_/]+$/ }, async (args) => {
        if (args.pluginData?.tglessProbe) return undefined;
        const name = args.path.replace(/^node:/, '');
        if (!BUILTINS.has(name) && !args.path.startsWith('node:')) return undefined;
        if (!(opts.polyfills && POLYFILLS[name])) {
          // A package's `browser` field (e.g. "fs": false) or an installed npm polyfill wins.
          const probe = await build.resolve(name, {
            kind: args.kind,
            resolveDir: args.resolveDir,
            importer: args.importer,
            pluginData: { tglessProbe: true },
          });
          if (!probe.errors.length && !probe.external) {
            // `"fs": false` in a browser map resolves to a disabled (non-file) module.
            if ((!probe.namespace || probe.namespace === 'file') && !path.isAbsolute(probe.path)) return { path: name, namespace: 'tgless-empty' };
            return { path: probe.path, namespace: probe.namespace, sideEffects: probe.sideEffects };
          }
        }
        if (opts.polyfills && POLYFILLS[name]) {
          return { path: require.resolve(POLYFILLS[name]) };
        }
        if (opts.allowEmpty?.includes(name)) {
          return { path: name, namespace: 'tgless-empty' };
        }
        const pkg = packageOf(args.importer) ?? path.relative(process.cwd(), args.importer);
        opts.problems.push({ pkg, builtin: name, importer: args.importer });
        // Keep going to report every problem at once; the stub throws if it is ever used.
        return { path: name, namespace: 'tgless-missing' };
      });
      build.onLoad({ filter: /.*/, namespace: 'tgless-empty' }, () => ({ contents: 'export default {};', loader: 'js' }));
      build.onLoad({ filter: /.*/, namespace: 'tgless-missing' }, (args) => ({
        contents: `const fail = () => { throw new Error(${JSON.stringify(`Node built-in "${args.path}" is not available on tgcloud.`)}); };
const proxy = new Proxy(function () {}, { get: (t, k) => (k === '__esModule' || k === 'then' ? undefined : fail()), apply: fail, construct: fail });
export default proxy;`,
        loader: 'js',
      }));
    },
  };
}

/** For the manifest pass: replace `sdk` with an inert stub so user code can be evaluated in Node. */
export function sdkStubPlugin(): Plugin {
  const stub = `
const handler = { get: (t, k) => k === 'then' ? undefined : k === Symbol.toPrimitive ? () => '' : proxy, apply: () => proxy };
const proxy = new Proxy(function () {}, handler);
export default proxy;
export const db = proxy, api = proxy, fetch = proxy, InputFile = class {}, BotApiError = class extends Error {}, EndpointError = class extends Error {}, FormData = class {};
export const table = proxy, integer = proxy, text = proxy, real = proxy, numeric = proxy, blob = proxy, json = proxy, index = proxy, uniqueIndex = proxy, unique = proxy, check = proxy, primaryKey = proxy, sql = proxy;
export const eq = proxy, ne = proxy, gt = proxy, gte = proxy, lt = proxy, lte = proxy, like = proxy, notLike = proxy, isNull = proxy, isNotNull = proxy, and = proxy, or = proxy, not = proxy, between = proxy, notBetween = proxy, inArray = proxy, notInArray = proxy, asc = proxy, desc = proxy, count = proxy, sum = proxy, avg = proxy, min = proxy, max = proxy;
export { proxy as boolean };
`;
  return {
    name: 'tgless-sdk-stub',
    setup(build) {
      build.onResolve({ filter: /^sdk(\/.*)?$/ }, (args) => ({ path: args.path, namespace: 'tgless-sdk-stub' }));
      build.onLoad({ filter: /.*/, namespace: 'tgless-sdk-stub' }, () => ({ contents: stub, loader: 'js' }));
    },
  };
}
