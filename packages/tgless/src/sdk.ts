/**
 * Internal description of the tgcloud platform SDK (`sdk` and `sdk/db`).
 *
 * The runtime never imports `sdk` directly. The generated entry (`tgcloud/lib/app.js`)
 * imports the real modules and hands them to `app.bind()`. Tests hand in the mock
 * from `tgless/testing`. This keeps the framework testable and platform-agnostic.
 */
import type { ApiMethods } from '@grammyjs/types';

/** Bytes + filename for uploads (the platform's `InputFile`). */
export interface InputFileLike {
  readonly __inputFile?: true;
}

type Params<M extends keyof ApiMethods<InputFileLike>> = Parameters<ApiMethods<InputFileLike>[M]>[0];
type Result<M extends keyof ApiMethods<InputFileLike>> = ReturnType<ApiMethods<InputFileLike>[M]>;

/** The Bot API as the platform exposes it: `api.method(params)` → unwrapped result. */
export type BotApi = {
  [M in keyof ApiMethods<InputFileLike>]: Params<M> extends undefined
    ? (params?: Params<M>) => Promise<Result<M>>
    : (params: Params<M>) => Promise<Result<M>>;
} & {
  getFileContent(fileId: string | { file_id: string }): Promise<Uint8Array>;
  getFileStream(fileId: string | { file_id: string }): Promise<{
    file: unknown;
    body: AsyncIterable<Uint8Array>;
    bytes(): Promise<Uint8Array>;
  }>;
  /** Any method not (yet) in the typings. */
  [method: string]: (params?: any) => Promise<any>;
};

export interface SdkResponse {
  status: number;
  statusText: string;
  ok: boolean;
  url: string;
  headers: { get(name: string): string | null; has(name: string): boolean };
  bodyUsed: boolean;
  body: AsyncIterable<Uint8Array>;
  json<T = any>(): Promise<T>;
  text(): Promise<string>;
}

export interface SdkFetch {
  (url: string, init?: { method?: string; headers?: Record<string, string>; body?: unknown }): Promise<SdkResponse>;
  body: {
    json(v: unknown): unknown;
    form(v: Record<string, unknown>): unknown;
    text(v: string): unknown;
  };
}

/** `import * as sdk from 'sdk'` */
export interface SdkModule {
  api: BotApi;
  db: SdkDatabase;
  fetch: SdkFetch;
  InputFile: new (bytes: Uint8Array | ArrayBuffer, filename: string, opts?: { type?: string }) => InputFileLike;
  BotApiError: new (...args: any[]) => Error;
  EndpointError: new (description: string, parameters?: Record<string, unknown>) => Error;
  FormData?: any;
}

export interface RunResult {
  rowsAffected: number;
  lastInsertRowid: number | bigint;
  rows: any[];
}

/** The `db` object: query builder + raw SQL. Builders are kept loosely typed on purpose. */
export interface SdkDatabase {
  select(projection?: Record<string, unknown>): any;
  insert(table: any): any;
  update(table: any): any;
  delete(table: any): any;
  $count(table: any, where?: unknown): Promise<number>;
  run(query: unknown, params?: unknown): Promise<RunResult>;
  all(query: unknown, params?: unknown): Promise<any[]>;
  get(query: unknown, params?: unknown): Promise<any | null>;
  values(query: unknown, params?: unknown): Promise<unknown[][]>;
}

/** `import * as sdkDb from 'sdk/db'`: schema DSL + operators. */
export interface SdkDbModule {
  table: (...args: any[]) => any;
  integer: (...args: any[]) => any;
  text: (...args: any[]) => any;
  real: (...args: any[]) => any;
  numeric: (...args: any[]) => any;
  blob: (...args: any[]) => any;
  boolean: (...args: any[]) => any;
  json: (...args: any[]) => any;
  index: (name: string) => any;
  uniqueIndex: (name: string) => any;
  unique: (name?: string) => any;
  check: (name: string, expr: unknown) => any;
  primaryKey: (...args: any[]) => any;
  sql: any;
  eq: (a: any, b: any) => any;
  ne: (a: any, b: any) => any;
  gt: (a: any, b: any) => any;
  gte: (a: any, b: any) => any;
  lt: (a: any, b: any) => any;
  lte: (a: any, b: any) => any;
  like: (a: any, b: any) => any;
  notLike: (a: any, b: any) => any;
  isNull: (a: any) => any;
  isNotNull: (a: any) => any;
  and: (...a: any[]) => any;
  or: (...a: any[]) => any;
  not: (a: any) => any;
  between: (a: any, b: any, c: any) => any;
  notBetween: (a: any, b: any, c: any) => any;
  inArray: (a: any, b: any[]) => any;
  notInArray: (a: any, b: any[]) => any;
  asc: (a: any) => any;
  desc: (a: any) => any;
  count: (a?: any) => any;
  sum: (a: any) => any;
  avg: (a: any) => any;
  min: (a: any) => any;
  max: (a: any) => any;
}

/** Everything the runtime needs from the platform. */
export interface Platform {
  sdk: SdkModule;
  dbModule: SdkDbModule;
  /** Exports of the generated `tgcloud/schema.js` (export name → table). */
  schema: Record<string, unknown>;
}
