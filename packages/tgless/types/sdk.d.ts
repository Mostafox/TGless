/**
 * Ambient types for the tgcloud platform modules, for code that imports them
 * directly (`import { InputFile } from 'sdk'`). Add to tsconfig:
 *   "types": ["tglessjs/sdk"]
 * Prefer the framework APIs (ctx.api, ctx.fetch, entities) — they are typed and testable.
 */
declare module 'sdk' {
  import type { BotApi, SdkDatabase, SdkFetch, InputFileLike } from 'tglessjs';
  export const api: BotApi;
  export const db: SdkDatabase;
  export const fetch: SdkFetch;
  export class InputFile implements InputFileLike {
    constructor(bytes: Uint8Array | ArrayBuffer, filename: string, opts?: { type?: string });
  }
  export class BotApiError extends Error {
    code: number;
    description: string;
    method: string;
    parameters?: { retry_after?: number; migrate_to_chat_id?: number };
  }
  export class EndpointError extends Error {
    constructor(description: string, parameters?: Record<string, unknown>);
  }
  export class FormData {
    append(name: string, value: unknown, filename?: string): void;
  }
}

declare module 'sdk/db' {
  import type { SdkDbModule, SdkDatabase } from 'tglessjs';
  const db: SdkDatabase & SdkDbModule;
  export default db;
  export const table: SdkDbModule['table'];
  export const integer: SdkDbModule['integer'];
  export const text: SdkDbModule['text'];
  export const real: SdkDbModule['real'];
  export const numeric: SdkDbModule['numeric'];
  export const blob: SdkDbModule['blob'];
  export const json: SdkDbModule['json'];
  export const index: SdkDbModule['index'];
  export const uniqueIndex: SdkDbModule['uniqueIndex'];
  export const check: SdkDbModule['check'];
  export const sql: SdkDbModule['sql'];
  export const eq: SdkDbModule['eq'];
  export const ne: SdkDbModule['ne'];
  export const gt: SdkDbModule['gt'];
  export const gte: SdkDbModule['gte'];
  export const lt: SdkDbModule['lt'];
  export const lte: SdkDbModule['lte'];
  export const like: SdkDbModule['like'];
  export const notLike: SdkDbModule['notLike'];
  export const isNull: SdkDbModule['isNull'];
  export const isNotNull: SdkDbModule['isNotNull'];
  export const and: SdkDbModule['and'];
  export const or: SdkDbModule['or'];
  export const not: SdkDbModule['not'];
  export const between: SdkDbModule['between'];
  export const inArray: SdkDbModule['inArray'];
  export const notInArray: SdkDbModule['notInArray'];
  export const asc: SdkDbModule['asc'];
  export const desc: SdkDbModule['desc'];
  export const count: SdkDbModule['count'];
  export const sum: SdkDbModule['sum'];
  export const avg: SdkDbModule['avg'];
  export const min: SdkDbModule['min'];
  export const max: SdkDbModule['max'];
}
