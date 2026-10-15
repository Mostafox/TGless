/**
 * Column builders for `entity()`.
 *
 * Opinionated defaults: columns are NOT NULL unless `.optional()`, and camelCase
 * keys become snake_case column names (`tgId` → `tg_id`) unless `.named()`.
 * Every builder is immutable, so chaining always returns a new column.
 */

export type ColumnKind = 'integer' | 'text' | 'real' | 'numeric' | 'blob' | 'boolean' | 'json';
export type ColumnMode = 'timestamp' | 'timestamp_ms';

export interface ColumnSpec {
  kind: ColumnKind;
  mode?: ColumnMode;
  /** SQL column name; defaults to snake_case of the key. */
  name?: string;
  primary?: boolean;
  autoIncrement?: boolean;
  notNull: boolean;
  unique?: boolean;
  /** Literal default stored in the schema (`DEFAULT ...`). */
  default?: { value: unknown };
  /** Raw SQL default, e.g. `(unixepoch())`. */
  defaultSql?: string;
  /** JS-side default, computed on insert (not in the schema). */
  defaultFn?: () => unknown;
  /** Set to `new Date()` on every repository update. */
  onUpdateNow?: boolean;
  generated?: { sql: string; mode: 'stored' | 'virtual' };
  deprecated?: string;
  /** Single-column index; `true` = auto name. */
  index?: boolean | string;
  /** Allowed values for `c.enum()`; emitted as a CHECK constraint. */
  enumValues?: readonly string[];
  /** Arbitrary column-level DDL (e.g. `COLLATE NOCASE`). */
  constraint?: string;
}

/** `rw` = normal, `ro` = generated (never inserted), `gone` = deprecated. */
export type ColumnAccess = 'rw' | 'ro' | 'gone';

export class Column<T = unknown, Optional extends boolean = boolean, Access extends ColumnAccess = ColumnAccess> {
  declare readonly __type: T;
  declare readonly __optional: Optional;
  declare readonly __access: Access;

  constructor(readonly spec: ColumnSpec) {}

  private with<T2 = T, O2 extends boolean = Optional, A2 extends ColumnAccess = Access>(
    patch: Partial<ColumnSpec>,
  ): Column<T2, O2, A2> {
    return new Column<T2, O2, A2>({ ...this.spec, ...patch });
  }

  /** Allow NULL. The value type becomes `T | null` and it's optional on insert. */
  optional(): Column<T | null, true, Access> {
    return this.with({ notNull: false });
  }
  /** Alias of `optional()`. */
  nullable(): Column<T | null, true, Access> {
    return this.optional();
  }
  /** Literal default value (stored in the schema). */
  default(value: T): Column<T, true, Access> {
    return this.with({ default: { value } });
  }
  /** Raw SQL default, e.g. `.defaultSql('(unixepoch())')`. Wrap expressions in parentheses. */
  defaultSql(expr: string): Column<T, true, Access> {
    return this.with({ defaultSql: expr });
  }
  /** Computed in JS on every insert (not part of the DB schema). */
  defaultFn(fn: () => T): Column<T, true, Access> {
    return this.with({ defaultFn: fn });
  }
  unique(): Column<T, Optional, Access> {
    return this.with({ unique: true });
  }
  primary(): Column<T, Optional, Access> {
    return this.with({ primary: true });
  }
  /** Add a single-column index (name is generated unless given). */
  index(name?: string): Column<T, Optional, Access> {
    return this.with({ index: name ?? true });
  }
  /** Use a custom SQL column name. */
  named(sqlName: string): Column<T, Optional, Access> {
    return this.with({ name: sqlName });
  }
  /** Raw column-level DDL, e.g. `.constraint('COLLATE NOCASE')`. */
  constraint(ddl: string): Column<T, Optional, Access> {
    return this.with({ constraint: ddl });
  }
  /** `GENERATED ALWAYS AS (expr)`; read-only, never inserted. */
  generated(expr: string, mode: 'stored' | 'virtual' = 'virtual'): Column<T, true, 'ro'> {
    return this.with({ generated: { sql: expr, mode } });
  }
  /**
   * Mark the column for removal. It disappears from types and queries, and the
   * next `tgcloud migrate` offers to drop it. (Deleting the key does NOT drop it.)
   */
  deprecated(reason: string): Column<T, true, 'gone'> {
    return this.with({ deprecated: reason });
  }
}

export type AnyColumn = Column<any, boolean, ColumnAccess>;

const col = <T>(kind: ColumnKind, extra: Partial<ColumnSpec> = {}) =>
  new Column<T, false, 'rw'>({ kind, notNull: true, ...extra });

function uuidV4(): string {
  const c = (globalThis as any).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Column factories. */
export const c = {
  /** INTEGER PRIMARY KEY AUTOINCREMENT. */
  id: () => new Column<number, true, 'rw'>({ kind: 'integer', notNull: true, primary: true, autoIncrement: true }),
  /** TEXT primary key filled with a random UUID on insert. */
  uuid: () =>
    new Column<string, true, 'rw'>({ kind: 'text', notNull: true, primary: true, defaultFn: uuidV4 }),
  int: () => col<number>('integer'),
  integer: () => col<number>('integer'),
  real: () => col<number>('real'),
  float: () => col<number>('real'),
  numeric: () => col<number>('numeric'),
  /** TEXT. Narrow it with a type parameter: `c.text<'a' | 'b'>()`. */
  text: <T extends string = string>() => col<T>('text'),
  /** TEXT restricted to the given values (adds a CHECK constraint). */
  enum: <const V extends readonly [string, ...string[]]>(values: V) =>
    col<V[number]>('text', { enumValues: values }),
  bool: () => col<boolean>('boolean'),
  boolean: () => col<boolean>('boolean'),
  /** JSON stored as TEXT; auto-serialized. */
  json: <T = unknown>() => col<T>('json'),
  blob: () => col<Uint8Array>('blob'),
  /** Date stored as unix seconds. */
  date: () => col<Date>('integer', { mode: 'timestamp' }),
  /** Date stored as unix milliseconds. */
  dateMs: () => col<Date>('integer', { mode: 'timestamp_ms' }),
  /** Date column defaulting to the insert time. */
  createdAt: () => col<Date>('integer', { mode: 'timestamp', defaultSql: '(unixepoch())' }) as unknown as Column<Date, true, 'rw'>,
  /** Date column set on insert and refreshed on every repository update. */
  updatedAt: () =>
    col<Date>('integer', { mode: 'timestamp', defaultSql: '(unixepoch())', onUpdateNow: true }) as unknown as Column<Date, true, 'rw'>,
  /** `...c.timestamps()` → `createdAt` + `updatedAt`. */
  timestamps: () => ({ createdAt: c.createdAt(), updatedAt: c.updatedAt() }),
};

export function snakeCase(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

export function sqlName(key: string, spec: ColumnSpec): string {
  return spec.name ?? snakeCase(key);
}
