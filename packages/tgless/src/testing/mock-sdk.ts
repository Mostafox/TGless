import { createRequire } from 'node:module';
import { sqlName } from '../db/columns.js';
import type { Entity } from '../db/entity.js';
import type { Platform, SdkDbModule, SdkModule } from '../sdk.js';
import { entityDdl } from './ddl.js';

const require = createRequire(import.meta.url);

function load<T>(id: string): T {
  try {
    return require(id) as T;
  } catch (e) {
    throw new Error(
      `tglessjs/testing needs "${id}". Install the test dependencies:\n  npm i -D better-sqlite3 drizzle-orm\n(${(e as Error).message})`,
    );
  }
}

// ─────────────────────────── Bot API mock ───────────────────────────

export interface ApiCall {
  method: string;
  params: Record<string, any>;
}

export type ApiResponder = (params: Record<string, any>, call: ApiCall) => unknown;

export class MockBotApiError extends Error {
  constructor(
    readonly code: number,
    readonly description: string,
    readonly method = '',
    readonly parameters: Record<string, unknown> = {},
  ) {
    super(`${method}: ${code} ${description}`);
    this.name = 'BotApiError';
  }
}

export class MockApi {
  readonly calls: ApiCall[] = [];
  private responders = new Map<string, ApiResponder>();
  private messageId = 1000;
  readonly proxy: any;

  constructor(private readonly botUser = { id: 1, is_bot: true, first_name: 'TestBot', username: 'test_bot' }) {
    this.proxy = new Proxy(
      {},
      {
        get: (_t, method: string) => {
          if (method === 'then') return undefined;
          return (params: Record<string, any> = {}) => this.call(method, params);
        },
      },
    );
  }

  /** Stub a method's result: `api.respond('getChat', { id: 1, type: 'private' })`. */
  respond(method: string, result: unknown | ApiResponder) {
    this.responders.set(method, typeof result === 'function' ? (result as ApiResponder) : () => result);
    return this;
  }

  /** Make a method fail like the Bot API does. */
  fail(method: string, code = 400, description = 'Bad Request') {
    return this.respond(method, () => {
      throw new MockBotApiError(code, description, method);
    });
  }

  private async call(method: string, params: Record<string, any>) {
    const call = { method, params };
    this.calls.push(call);
    const r = this.responders.get(method);
    if (r) return r(params, call);
    return this.defaultResult(method, params);
  }

  private defaultResult(method: string, p: Record<string, any>): unknown {
    if (method === 'getMe') return this.botUser;
    if (method.startsWith('send') && method !== 'sendChatAction' && method !== 'sendMediaGroup') {
      const msg: Record<string, unknown> = {
        message_id: ++this.messageId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: p.chat_id, type: 'private' },
        from: this.botUser,
      };
      if (p.text !== undefined) msg.text = p.text;
      if (p.caption !== undefined) msg.caption = p.caption;
      if (p.reply_markup) msg.reply_markup = p.reply_markup;
      return msg;
    }
    if (method === 'getFileContent') return new Uint8Array();
    return true;
  }

  /** Calls to one method. */
  callsOf(method: string): Record<string, any>[] {
    return this.calls.filter((c) => c.method === method).map((c) => c.params);
  }

  reset() {
    this.calls.length = 0;
  }
}

// ─────────────────────────── fetch mock ───────────────────────────

type FetchHandler = (url: string, init: any) => unknown;

export class MockFetch {
  private routes: { match: string | RegExp; handler: FetchHandler }[] = [];
  readonly requests: { url: string; init: any }[] = [];
  readonly fn: any;

  constructor() {
    const fn = async (url: string, init: any = {}) => {
      this.requests.push({ url, init });
      const route = this.routes.find((r) => (typeof r.match === 'string' ? url.startsWith(r.match) : r.match.test(url)));
      if (!route) throw new Error(`Unmocked fetch: ${init.method ?? 'GET'} ${url}. Use bot.fetch.mock(url, response).`);
      const res = await route.handler(url, init);
      return toResponse(url, res);
    };
    fn.body = {
      json: (v: unknown) => JSON.stringify(v),
      form: (v: Record<string, unknown>) => new URLSearchParams(v as Record<string, string>).toString(),
      text: (v: string) => v,
    };
    this.fn = fn;
  }

  /** `mock('https://api.x.com/', { status: 200, json: {...} })` or a handler function. */
  mock(match: string | RegExp, response: { status?: number; json?: unknown; text?: string } | FetchHandler) {
    this.routes.push({ match, handler: typeof response === 'function' ? response : () => response });
    return this;
  }
}

function toResponse(url: string, r: any) {
  if (r && typeof r === 'object' && typeof r.json === 'function' && 'status' in r) return r;
  const status = r?.status ?? 200;
  const text = r?.text ?? (r?.json !== undefined ? JSON.stringify(r.json) : '');
  let used = false;
  const read = () => {
    if (used) throw new TypeError('body used already');
    used = true;
    return text;
  };
  return {
    status,
    statusText: String(status),
    ok: status >= 200 && status < 300,
    url,
    headers: new Map(Object.entries(r?.headers ?? {})),
    get bodyUsed() {
      return used;
    },
    json: async () => JSON.parse(read()),
    text: async () => read(),
  };
}

// ─────────────────────────── database ───────────────────────────

export class MockEndpointError extends Error {
  constructor(
    readonly description: string,
    readonly parameters: Record<string, unknown> = {},
  ) {
    super(description);
    this.name = 'EndpointError';
  }
}

class MockInputFile {
  readonly __inputFile = true;
  constructor(
    readonly bytes: Uint8Array | ArrayBuffer,
    readonly filename: string,
    readonly opts: { type?: string } = {},
  ) {}
}

/** Build a drizzle table matching an entity (same JS keys as the generated schema.js). */
function drizzleTable(e: Entity<any, any>, core: any, orm: any) {
  const cols: Record<string, any> = {};
  for (const [key, spec] of e.liveColumns()) {
    const name = sqlName(key, spec);
    let col: any;
    switch (spec.kind) {
      case 'integer':
        col = spec.mode ? core.integer(name, { mode: spec.mode }) : core.integer(name);
        break;
      case 'boolean':
        col = core.integer(name, { mode: 'boolean' });
        break;
      case 'json':
        col = core.text(name, { mode: 'json' });
        break;
      case 'text':
        col = core.text(name);
        break;
      case 'real':
        col = core.real(name);
        break;
      case 'numeric':
        col = core.numeric(name, { mode: 'number' });
        break;
      case 'blob':
        col = core.blob(name, { mode: 'buffer' });
        break;
    }
    if (spec.primary && !e.options.primaryKey) col = col.primaryKey(spec.autoIncrement ? { autoIncrement: true } : undefined);
    if (spec.notNull && !spec.primary) col = col.notNull();
    if (spec.defaultSql !== undefined) col = col.default(orm.sql.raw(spec.defaultSql));
    else if (spec.default !== undefined) col = col.default(spec.default.value);
    if (spec.generated) col = col.generatedAlwaysAs(orm.sql.raw(spec.generated.sql), { mode: spec.generated.mode });
    cols[key] = col;
  }
  return core.sqliteTable(e.tableName, cols);
}

export interface MockPlatform extends Platform {
  api: MockApi;
  fetch: MockFetch;
  /** The better-sqlite3 database (for assertions / raw SQL). */
  sqlite: any;
}

/** A complete fake `sdk` + `sdk/db` + schema for the given entities, backed by in-memory SQLite. */
export function createMockPlatform(entities: Entity<any, any>[]): MockPlatform {
  const Database = load<any>('better-sqlite3');
  const orm = load<any>('drizzle-orm');
  const core = load<any>('drizzle-orm/sqlite-core');
  const { drizzle } = load<any>('drizzle-orm/better-sqlite3');

  const sqlite = new Database(':memory:');
  const schema: Record<string, unknown> = {};
  for (const e of entities) {
    for (const stmt of entityDdl(e)) sqlite.exec(stmt);
    schema[e.exportName] = drizzleTable(e, core, orm);
  }
  const ddb = drizzle(sqlite);

  const runResult = (r: any) => ({ rowsAffected: r?.changes ?? 0, lastInsertRowid: r?.lastInsertRowid ?? 0, rows: [] });
  const rawStmt = (query: any, params: any) => {
    const stmt = sqlite.prepare(query);
    const args = params && typeof params === 'object' && !Array.isArray(params)
      ? Object.fromEntries(Object.entries(params).map(([k, v]) => [k.replace(/^[:@$]/, ''), v]))
      : params;
    return { stmt, args: args === undefined ? [] : [args] };
  };
  const db = Object.assign(Object.create(ddb), {
    async run(query: any, params?: any) {
      if (typeof query === 'string') {
        const { stmt, args } = rawStmt(query, params);
        if (stmt.reader) return { rowsAffected: 0, lastInsertRowid: 0, rows: stmt.all(...args) };
        return runResult(stmt.run(...args));
      }
      return runResult(ddb.run(query));
    },
    async all(query: any, params?: any) {
      if (typeof query === 'string') {
        const { stmt, args } = rawStmt(query, params);
        return stmt.all(...args);
      }
      return ddb.all(query);
    },
    async get(query: any, params?: any) {
      if (typeof query === 'string') {
        const { stmt, args } = rawStmt(query, params);
        return stmt.get(...args) ?? null;
      }
      return ddb.get(query) ?? null;
    },
    async values(query: any, params?: any) {
      if (typeof query === 'string') {
        const { stmt, args } = rawStmt(query, params);
        return stmt.raw().all(...args);
      }
      return ddb.values(query);
    },
  });

  const dbModule: SdkDbModule = {
    ...orm,
    table: core.sqliteTable,
    integer: core.integer,
    text: core.text,
    real: core.real,
    numeric: core.numeric,
    blob: core.blob,
    boolean: (name: string) => core.integer(name, { mode: 'boolean' }),
    json: (name: string) => core.text(name, { mode: 'json' }),
    index: core.index,
    uniqueIndex: core.uniqueIndex,
    unique: core.unique,
    check: core.check,
    primaryKey: core.primaryKey,
    sql: orm.sql,
  };

  const api = new MockApi();
  const fetch = new MockFetch();
  const sdk: SdkModule = {
    api: api.proxy,
    db,
    fetch: fetch.fn,
    InputFile: MockInputFile as any,
    BotApiError: MockBotApiError,
    EndpointError: MockEndpointError,
  };
  return { sdk, dbModule, schema, api, fetch, sqlite };
}
