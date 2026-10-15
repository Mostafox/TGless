export interface TglessConfig {
  /** App entry exporting `createApp(...)` as default. Default `src/main.ts`. */
  entry?: string;
  /** Minify the bundle. Default `false` (readable stack traces in `tgcloud run`). */
  minify?: boolean;
  /** Compile-time constants, e.g. `{ 'process.env.NODE_ENV': '"production"' }`. */
  define?: Record<string, string>;
  /**
   * Polyfill the Node built-ins we can (`buffer`, `events`, plus `Buffer`/`process`
   * globals). Other built-ins fail the build unless a package's `browser` field,
   * an installed npm polyfill, `alias` or `stubBuiltins` covers them. Default `true`.
   */
  polyfills?: boolean;
  /**
   * Node built-ins to replace with an empty module, for libraries that import them
   * but don't really need them at runtime (e.g. `['fs', 'path']`).
   */
  stubBuiltins?: string[];
  /**
   * Install the platform's `fetch` as `globalThis.fetch`, so npm libraries that use
   * `fetch()` work. Default `true`.
   */
  fetchShim?: boolean;
  /** Module aliases, e.g. `{ 'node-fetch': './src/shims/fetch.ts' }`. */
  alias?: Record<string, string>;
  /** Warn when a generated file is larger than this many bytes. Default 5 MB. */
  maxFileSize?: number;
  /** Target for the bundle. Default `es2022`. */
  target?: string;
}

/** Typed helper for `tgless.config.ts`. */
export function defineConfig(config: TglessConfig): TglessConfig {
  return config;
}
