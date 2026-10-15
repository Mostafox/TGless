import type { SdkDatabase, SdkDbModule } from '../sdk.js';
import { type AnyColumn, type Column, type ColumnSpec, sqlName } from './columns.js';
import { type Op, isOp } from './operators.js';

// ───────────────────────────── types ─────────────────────────────

type Simplify<T> = { [K in keyof T]: T[K] } & {};

export type Columns = Record<string, AnyColumn>;

type LiveKeys<C extends Columns> = {
  [K in keyof C]: C[K] extends Column<any, any, 'gone'> ? never : K;
}[keyof C];
type WritableKeys<C extends Columns> = {
  [K in keyof C]: C[K] extends Column<any, any, 'rw'> ? K : never;
}[keyof C];
type OptionalKeys<C extends Columns> = {
  [K in WritableKeys<C>]: C[K] extends Column<any, true, any> ? K : never;
}[WritableKeys<C>];
type RequiredKeys<C extends Columns> = Exclude<WritableKeys<C>, OptionalKeys<C>>;
type ColType<X> = X extends Column<infer T, any, any> ? T : never;

/** A selected row. */
export type RowOf<C extends Columns> = Simplify<{ [K in LiveKeys<C>]: ColType<C[K]> }>;
/** Data accepted by `create()`. */
export type InsertOf<C extends Columns> = Simplify<
  { [K in RequiredKeys<C>]: ColType<C[K]> } & { [K in OptionalKeys<C>]?: ColType<C[K]> }
>;
/** Data accepted by `update()`. */
export type UpdateOf<C extends Columns> = Simplify<{ [K in WritableKeys<C>]?: ColType<C[K]> }>;

/** `type User = Infer<typeof Users>` */
export type Infer<E> = E extends Entity<infer C, any> ? RowOf<C> : never;
export type InferInsert<E> = E extends Entity<infer C, any> ? InsertOf<C> : never;

type FieldCondition<T> = T | Op<NonNullable<T>> | (null extends T ? null : never);

export type WhereObject<C extends Columns> = {
  [K in LiveKeys<C>]?: FieldCondition<ColType<C[K]>>;
} & {
  OR?: Where<C>[];
  AND?: Where<C>[];
  NOT?: Where<C>;
};
/** An object of field conditions, or a raw callback using `sdk/db` operators. */
export type Where<C extends Columns> = WhereObject<C> | ((table: any, ops: SdkDbModule) => unknown);

export type OrderBy<C extends Columns> =
  | { [K in LiveKeys<C>]?: 'asc' | 'desc' }
  | Array<{ [K in LiveKeys<C>]?: 'asc' | 'desc' }>;

// ── relations ──

export interface Relation<Kind extends 'many' | 'one' = 'many' | 'one', E extends Entity<any, any> = Entity<any, any>> {
  kind: Kind;
  type: 'hasMany' | 'hasOne' | 'belongsTo';
  target: () => E;
  /** Column on the child (hasMany/hasOne) or on this entity (belongsTo). */
  foreignKey: string;
  /** Column on the other side the foreign key points to (default `id`). */
  key: string;
}
export type Relations = Record<string, Relation>;

export interface RelationBuilders {
  /** `orders: r.hasMany(() => Orders, 'userId')` (Orders.userId → this.id) */
  hasMany<E extends Entity<any, any>>(target: () => E, foreignKey: string, localKey?: string): Relation<'many', E>;
  /** `profile: r.hasOne(() => Profiles, 'userId')` */
  hasOne<E extends Entity<any, any>>(target: () => E, foreignKey: string, localKey?: string): Relation<'one', E>;
  /** `user: r.belongsTo(() => Users, 'userId')` (this.userId → Users.id) */
  belongsTo<E extends Entity<any, any>>(target: () => E, foreignKey: string, targetKey?: string): Relation<'one', E>;
}

const relationBuilders: RelationBuilders = {
  hasMany: (target, foreignKey, localKey = 'id') => ({ kind: 'many', type: 'hasMany', target, foreignKey, key: localKey }),
  hasOne: (target, foreignKey, localKey = 'id') => ({ kind: 'one', type: 'hasOne', target, foreignKey, key: localKey }),
  belongsTo: (target, foreignKey, targetKey = 'id') => ({ kind: 'one', type: 'belongsTo', target, foreignKey, key: targetKey }),
};

type RelEntity<R> = R extends Relation<any, infer E> ? E : never;
type RelColumns<R> = RelEntity<R> extends Entity<infer C, any> ? C : never;
type RelRelations<R> = RelEntity<R> extends Entity<any, infer RR> ? RR : never;

export type WithSpec<R extends Relations> = {
  [K in keyof R]?:
    | true
    | {
        where?: Where<RelColumns<R[K]>>;
        orderBy?: OrderBy<RelColumns<R[K]>>;
        with?: WithSpec<RelRelations<R[K]>>;
      };
};

type Loaded<R extends Relation, S> = Simplify<
  RowOf<RelColumns<R>> & (S extends { with: infer W } ? WithResult<RelRelations<R>, W> : {})
>;
export type WithResult<R extends Relations, W> = {
  [K in keyof W & keyof R]: R[K]['kind'] extends 'many' ? Loaded<R[K], W[K]>[] : Loaded<R[K], W[K]> | null;
};

export interface FindManyOptions<C extends Columns, R extends Relations, W extends WithSpec<R> | undefined> {
  where?: Where<C>;
  orderBy?: OrderBy<C>;
  limit?: number;
  offset?: number;
  with?: W;
}

export type FindResult<C extends Columns, R extends Relations, W> = W extends object
  ? Simplify<RowOf<C> & WithResult<R, W>>
  : RowOf<C>;

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
  hasNext: boolean;
}

// ── options ──

export interface IndexSpec<C extends Columns> {
  columns: (keyof C & string)[];
  name?: string;
  unique?: boolean;
  /** Partial index condition (raw SQL), e.g. `'done = 0'`. */
  where?: string;
}

export interface EntityOptions<C extends Columns> {
  /** Composite indexes. Single-column ones are simpler: `c.int().index()`. */
  indexes?: Array<IndexSpec<C> | (keyof C & string)[]>;
  /** Composite primary key. */
  primaryKey?: (keyof C & string)[];
  /** CHECK constraints: `{ positive_price: 'price > 0' }` (raw SQL, use column SQL names). */
  checks?: Record<string, string>;
  strict?: boolean;
  withoutRowid?: boolean;
  /** Mark the whole table for removal on the next `tgcloud migrate`. */
  deprecated?: string;
  /** Name of the export in the generated schema.js (default: derived from the table name). */
  exportName?: string;
}

// ───────────────────────────── registry ─────────────────────────────

const registry: Entity<any, any>[] = [];

/** Every entity declared so far (in import order). Used by the build to generate schema.js. */
export function getEntityRegistry(): readonly Entity<any, any>[] {
  return registry;
}

export class EntityNotFoundError extends Error {
  constructor(table: string, where: unknown) {
    super(`No row in "${table}" matching ${safeJson(where)}`);
    this.name = 'EntityNotFoundError';
  }
}

function safeJson(v: unknown) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

const RESERVED = new Set(
  'break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield await'.split(' '),
);

function toIdentifier(name: string) {
  const id = name.replace(/[^A-Za-z0-9_$]/g, '_');
  if (RESERVED.has(id)) return `${id}_`;
  return /^[0-9]/.test(id) ? `_${id}` : id;
}

/** SQLite's historical bound-parameter limit; batches are chunked below it. */
const MAX_VARS = 999;

// ───────────────────────────── entity ─────────────────────────────

/**
 * A database table plus a typed repository.
 *
 * ```ts
 * export const Users = entity('users', {
 *   id: c.id(),
 *   tgId: c.int().unique(),
 *   name: c.text(),
 *   ...c.timestamps(),
 * })
 * const user = await Users.find({ tgId: 42 })
 * ```
 */
export class Entity<C extends Columns, R extends Relations = {}> {
  readonly exportName: string;
  readonly relationMap: R = {} as R;
  /** Internal entities (e.g. sessions) are only emitted when a feature needs them. */
  internal = false;

  private _table: any;
  private _db?: SdkDatabase;
  private _ops?: SdkDbModule;

  constructor(
    readonly tableName: string,
    readonly columns: C,
    readonly options: EntityOptions<C> = {},
  ) {
    this.exportName = options.exportName ?? toIdentifier(tableName);
  }

  // ── wiring ──

  /** Attach the platform table (from schema.js) and database. Done by the app. */
  bind(table: unknown, db: SdkDatabase, ops: SdkDbModule) {
    this._table = table;
    this._db = db;
    this._ops = ops;
  }

  get isBound() {
    return !!this._table;
  }

  /** The platform table object (for raw `sdk/db` queries): `Users.table.tgId`. */
  get table(): any {
    if (!this._table) {
      throw new Error(
        `Entity "${this.tableName}" is not bound to the database. ` +
          `Make sure it is imported by your app (or listed in a module's \`entities\`) and that the app was built with tgless.`,
      );
    }
    return this._table;
  }
  /** Raw database handle (`sdk` db). */
  get db(): SdkDatabase {
    this.table;
    return this._db!;
  }
  /** `sdk/db` operators (`eq`, `and`, `sql`, …) for raw queries. */
  get ops(): SdkDbModule {
    this.table;
    return this._ops!;
  }

  /** Declare relations (no foreign keys are created; integrity is up to you). */
  relations<NR extends Relations>(define: (r: RelationBuilders) => NR): Entity<C, R & NR> {
    Object.assign(this.relationMap, define(relationBuilders));
    return this as unknown as Entity<C, R & NR>;
  }

  /** Live (non-deprecated) column specs keyed by JS key. */
  liveColumns(): [string, ColumnSpec][] {
    return Object.entries(this.columns)
      .filter(([, col]) => !col.spec.deprecated)
      .map(([k, col]) => [k, col.spec]);
  }

  primaryKey(): string {
    const pk = Object.entries(this.columns).find(([, col]) => col.spec.primary);
    if (pk) return pk[0];
    if ('id' in this.columns) return 'id';
    throw new Error(`Entity "${this.tableName}" has no primary key column.`);
  }

  sqlColumnName(key: string): string {
    const col = this.columns[key];
    if (!col) throw new Error(`Unknown column "${key}" on "${this.tableName}".`);
    return sqlName(key, col.spec);
  }

  // ── query helpers ──

  private col(key: string) {
    const ref = this.table[key];
    if (!ref || !(key in this.columns)) {
      throw new Error(`Unknown column "${key}" on entity "${this.tableName}".`);
    }
    return ref;
  }

  /** Translate a where object into an `sdk/db` expression. */
  buildWhere(where: Where<C> | undefined): unknown {
    if (!where) return undefined;
    const ops = this.ops;
    if (typeof where === 'function') return where(this.table, ops);
    const parts: unknown[] = [];
    for (const [key, value] of Object.entries(where)) {
      if (value === undefined) continue;
      if (key === 'OR' || key === 'AND') {
        const inner = (value as Where<C>[]).map((w) => this.buildWhere(w)).filter((x) => x !== undefined);
        if (inner.length) parts.push(key === 'OR' ? ops.or(...inner) : ops.and(...inner));
        continue;
      }
      if (key === 'NOT') {
        const inner = this.buildWhere(value as Where<C>);
        if (inner !== undefined) parts.push(ops.not(inner));
        continue;
      }
      const ref = this.col(key);
      if (value === null) parts.push(ops.isNull(ref));
      else if (isOp(value)) parts.push(this.applyOp(ref, value));
      else parts.push(ops.eq(ref, value));
    }
    if (!parts.length) return undefined;
    return parts.length === 1 ? parts[0] : ops.and(...parts);
  }

  private applyOp(ref: unknown, o: Op) {
    const ops = this.ops;
    switch (o.__op) {
      case 'isNull':
        return ops.isNull(ref);
      case 'isNotNull':
        return ops.isNotNull(ref);
      case 'between':
        return ops.between(ref, o.value, o.value2);
      case 'notBetween':
        return ops.notBetween(ref, o.value, o.value2);
      case 'inArray':
        return ops.inArray(ref, [...(o.value as unknown[])]);
      case 'notInArray':
        return ops.notInArray(ref, [...(o.value as unknown[])]);
      default:
        return (ops[o.__op] as (a: unknown, b: unknown) => unknown)(ref, o.value);
    }
  }

  private buildOrder(orderBy: OrderBy<C> | undefined): unknown[] {
    if (!orderBy) return [];
    const list = Array.isArray(orderBy) ? orderBy : [orderBy];
    const out: unknown[] = [];
    for (const item of list) {
      for (const [key, dir] of Object.entries(item)) {
        out.push(dir === 'desc' ? this.ops.desc(this.col(key)) : this.ops.asc(this.col(key)));
      }
    }
    return out;
  }

  private prepareInsert(data: Record<string, unknown>) {
    const row: Record<string, unknown> = {};
    for (const [key, spec] of this.liveColumns()) {
      if (spec.generated) continue;
      const v = data[key];
      if (v !== undefined) row[key] = v;
      else if (spec.defaultFn) row[key] = spec.defaultFn();
    }
    for (const key of Object.keys(data)) {
      if (!(key in this.columns)) throw new Error(`Unknown column "${key}" on entity "${this.tableName}".`);
    }
    return row;
  }

  private prepareUpdate(data: Record<string, unknown>) {
    const set: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(data)) {
      if (v === undefined) continue;
      if (!(key in this.columns)) throw new Error(`Unknown column "${key}" on entity "${this.tableName}".`);
      set[key] = v;
    }
    for (const [key, spec] of this.liveColumns()) {
      if (spec.onUpdateNow && !(key in set)) set[key] = new Date();
    }
    return set;
  }

  // ── reads ──

  /** First row matching `where`, or `null`. */
  async find<W extends WithSpec<R> | undefined = undefined>(
    where: Where<C>,
    opts: { orderBy?: OrderBy<C>; with?: W } = {},
  ): Promise<FindResult<C, R, W> | null> {
    const rows = await this.findMany({ where, orderBy: opts.orderBy, with: opts.with, limit: 1 });
    return (rows[0] as FindResult<C, R, W>) ?? null;
  }

  /** Row by primary key, or `null`. */
  findById<W extends WithSpec<R> | undefined = undefined>(
    id: unknown,
    opts: { with?: W } = {},
  ): Promise<FindResult<C, R, W> | null> {
    return this.find({ [this.primaryKey()]: id } as Where<C>, opts);
  }

  /** Like `find`, but throws `EntityNotFoundError` when nothing matches. */
  async findOrFail<W extends WithSpec<R> | undefined = undefined>(
    where: Where<C>,
    opts: { orderBy?: OrderBy<C>; with?: W } = {},
  ): Promise<FindResult<C, R, W>> {
    const row = await this.find(where, opts);
    if (!row) throw new EntityNotFoundError(this.tableName, where);
    return row;
  }

  async findMany<W extends WithSpec<R> | undefined = undefined>(
    opts: FindManyOptions<C, R, W> = {},
  ): Promise<FindResult<C, R, W>[]> {
    let q = this.db.select().from(this.table);
    const cond = this.buildWhere(opts.where);
    if (cond !== undefined) q = q.where(cond);
    const order = this.buildOrder(opts.orderBy);
    if (order.length) q = q.orderBy(...order);
    if (opts.limit !== undefined) q = q.limit(opts.limit);
    if (opts.offset !== undefined) q = q.offset(opts.offset);
    const rows: Record<string, unknown>[] = await q.all();
    if (opts.with) await this.loadRelations(rows, opts.with as WithSpec<R>);
    return rows as FindResult<C, R, W>[];
  }

  async count(where?: Where<C>): Promise<number> {
    const cond = this.buildWhere(where);
    const n = cond === undefined ? await this.db.$count(this.table) : await this.db.$count(this.table, cond);
    return Number(n);
  }

  async exists(where: Where<C>): Promise<boolean> {
    let q = this.db.select().from(this.table);
    const cond = this.buildWhere(where);
    if (cond !== undefined) q = q.where(cond);
    return (await q.limit(1).all()).length > 0;
  }

  /** Offset pagination. `page` is 1-based. */
  async paginate<W extends WithSpec<R> | undefined = undefined>(
    opts: Omit<FindManyOptions<C, R, W>, 'limit' | 'offset'> & { page?: number; perPage?: number },
  ): Promise<Page<FindResult<C, R, W>>> {
    const perPage = Math.max(1, opts.perPage ?? 10);
    const page = Math.max(1, opts.page ?? 1);
    const [items, total] = await Promise.all([
      this.findMany({ ...opts, limit: perPage, offset: (page - 1) * perPage }),
      this.count(opts.where),
    ]);
    const pages = Math.max(1, Math.ceil(total / perPage));
    return { items, total, page, perPage, pages, hasNext: page < pages };
  }

  // ── writes ──

  async create(data: InsertOf<C>): Promise<RowOf<C>> {
    const rows = await this.db.insert(this.table).values(this.prepareInsert(data as any)).returning();
    return rows[0];
  }

  /** Insert many rows; batches are chunked under SQLite's variable limit. */
  async createMany(data: InsertOf<C>[]): Promise<RowOf<C>[]> {
    if (!data.length) return [];
    const prepared = data.map((d) => this.prepareInsert(d as any));
    const width = Math.max(1, ...prepared.map((r) => Object.keys(r).length));
    const size = Math.max(1, Math.floor(MAX_VARS / width));
    const out: RowOf<C>[] = [];
    for (let i = 0; i < prepared.length; i += size) {
      const rows = await this.db.insert(this.table).values(prepared.slice(i, i + size)).returning();
      out.push(...rows);
    }
    return out;
  }

  /** Update all rows matching `where`; returns the updated rows. */
  async update(where: Where<C>, data: UpdateOf<C>): Promise<RowOf<C>[]> {
    const cond = this.requireWhere(where, 'update');
    return await this.db.update(this.table).set(this.prepareUpdate(data as any)).where(cond).returning();
  }

  async updateById(id: unknown, data: UpdateOf<C>): Promise<RowOf<C> | null> {
    const rows = await this.update({ [this.primaryKey()]: id } as Where<C>, data);
    return rows[0] ?? null;
  }

  /**
   * Insert, or update when a row with the same `where` keys exists.
   * The `where` keys must be covered by a UNIQUE constraint or the primary key.
   */
  async upsert(args: { where: Partial<RowOf<C>>; create: Partial<InsertOf<C>>; update?: UpdateOf<C> }): Promise<RowOf<C>> {
    const keys = Object.keys(args.where);
    if (!keys.length) throw new Error('upsert() needs at least one key in `where`.');
    const values = this.prepareInsert({ ...args.create, ...args.where } as any);
    const set = this.prepareUpdate((args.update ?? args.create) as any);
    for (const k of keys) delete set[k];
    const target = keys.length === 1 ? this.col(keys[0]) : keys.map((k) => this.col(k));
    const q = this.db.insert(this.table).values(values);
    const rows = Object.keys(set).length
      ? await q.onConflictDoUpdate({ target, set }).returning()
      : await q.onConflictDoNothing({ target }).returning();
    if (rows[0]) return rows[0];
    return (await this.find(args.where as Where<C>)) as RowOf<C>;
  }

  /** Find by `where`, or create with `where` + `data`. */
  async findOrCreate(where: Partial<RowOf<C>>, data: Partial<InsertOf<C>> = {}): Promise<RowOf<C>> {
    const found = await this.find(where as Where<C>);
    if (found) return found as RowOf<C>;
    return this.upsert({ where, create: data });
  }

  /** Delete rows matching `where`; returns the number of deleted rows. */
  async delete(where: Where<C>): Promise<number> {
    const cond = this.requireWhere(where, 'delete');
    const res: any = await this.db.delete(this.table).where(cond);
    return Number(res?.rowsAffected ?? res?.changes ?? 0);
  }

  deleteById(id: unknown): Promise<number> {
    return this.delete({ [this.primaryKey()]: id } as Where<C>);
  }

  /** Atomically add `by` to a numeric column. Returns the updated rows. */
  async increment(where: Where<C>, key: keyof RowOf<C> & string, by = 1): Promise<RowOf<C>[]> {
    const cond = this.requireWhere(where, 'increment');
    const strings = Object.assign(['', ' + ', ''], { raw: ['', ' + ', ''] }) as unknown as TemplateStringsArray;
    const expr = this.ops.sql(strings, this.col(key), by);
    return await this.db
      .update(this.table)
      .set({ ...this.prepareUpdate({}), [key]: expr })
      .where(cond)
      .returning();
  }

  decrement(where: Where<C>, key: keyof RowOf<C> & string, by = 1) {
    return this.increment(where, key, -by);
  }

  /** Raw select builder: `await Users.select().where(...).orderBy(...)`. */
  select(projection?: Record<string, unknown>): any {
    return (projection ? this.db.select(projection) : this.db.select()).from(this.table);
  }

  private requireWhere(where: Where<C>, action: string) {
    const cond = this.buildWhere(where);
    if (cond === undefined) {
      throw new Error(
        `${this.tableName}.${action}() with an empty where would touch every row. ` +
          `Pass an explicit condition (use a raw query for intentional full-table writes).`,
      );
    }
    return cond;
  }

  // ── relations ──

  private async loadRelations(rows: Record<string, unknown>[], spec: WithSpec<R>) {
    if (!rows.length) return;
    for (const [name, opt] of Object.entries(spec)) {
      if (!opt) continue;
      const rel = this.relationMap[name];
      if (!rel) throw new Error(`Unknown relation "${name}" on "${this.tableName}".`);
      const target = rel.target();
      const sub = opt === true ? {} : (opt as { where?: any; orderBy?: any; with?: any });
      const ownKey = rel.type === 'belongsTo' ? rel.foreignKey : rel.key;
      const otherKey = rel.type === 'belongsTo' ? rel.key : rel.foreignKey;
      const keys = [...new Set(rows.map((r) => r[ownKey]).filter((v) => v !== null && v !== undefined))];
      const related: Record<string, unknown>[] = keys.length
        ? await target.findMany({
            where: { AND: [{ [otherKey]: { __op: 'inArray', value: keys } }, ...(sub.where ? [sub.where] : [])] },
            orderBy: sub.orderBy,
            with: sub.with,
          })
        : [];
      const groups = new Map<unknown, Record<string, unknown>[]>();
      for (const item of related) {
        const k = item[otherKey];
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(item);
      }
      for (const row of rows) {
        const list = groups.get(row[ownKey]) ?? [];
        row[name] = rel.kind === 'many' ? list : (list[0] ?? null);
      }
    }
  }
}

/** Declare a table. Entities register themselves so the build can emit `schema.js`. */
export function entity<const C extends Columns>(tableName: string, columns: C, options?: EntityOptions<C>): Entity<C> {
  const e = new Entity(tableName, columns, options);
  registry.push(e);
  return e;
}
