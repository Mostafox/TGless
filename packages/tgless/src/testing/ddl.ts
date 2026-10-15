import { type ColumnSpec, sqlName } from '../db/columns.js';
import type { Entity } from '../db/entity.js';

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;
const lit = (v: unknown): string => {
  if (v === null) return 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (v instanceof Date) return String(Math.floor(v.getTime() / 1000));
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return `'${s.replace(/'/g, "''")}'`;
};

const TYPE: Record<ColumnSpec['kind'], string> = {
  integer: 'integer',
  boolean: 'integer',
  text: 'text',
  json: 'text',
  real: 'real',
  numeric: 'numeric',
  blob: 'blob',
};

/** SQLite DDL equivalent to what tgcloud's migrate creates (used by the in-memory test DB). */
export function entityDdl(e: Entity<any, any>): string[] {
  if (e.options.deprecated !== undefined) return [];
  const defs: string[] = [];
  const live = e.liveColumns();
  for (const [key, spec] of live) {
    let d = `${q(sqlName(key, spec))} ${TYPE[spec.kind]}`;
    if (spec.primary && !e.options.primaryKey) d += spec.autoIncrement ? ' PRIMARY KEY AUTOINCREMENT' : ' PRIMARY KEY';
    if (spec.notNull && !spec.primary && !spec.generated) d += ' NOT NULL';
    if (spec.unique) d += ' UNIQUE';
    if (spec.defaultSql !== undefined) d += ` DEFAULT ${spec.defaultSql}`;
    else if (spec.default !== undefined) d += ` DEFAULT ${lit(spec.default.value)}`;
    if (spec.generated) d += ` GENERATED ALWAYS AS (${spec.generated.sql}) ${spec.generated.mode.toUpperCase()}`;
    if (spec.constraint) d += ` ${spec.constraint}`;
    if (spec.enumValues) {
      const list = spec.enumValues.map(lit).join(', ');
      d += ` CHECK (${q(sqlName(key, spec))} IN (${list})${spec.notNull ? '' : ` OR ${q(sqlName(key, spec))} IS NULL`})`;
    }
    defs.push(d);
  }
  if (e.options.primaryKey?.length) {
    defs.push(`PRIMARY KEY (${e.options.primaryKey.map((k: string) => q(e.sqlColumnName(k))).join(', ')})`);
  }
  for (const [name, expr] of Object.entries(e.options.checks ?? {})) {
    defs.push(`CONSTRAINT ${q(name)} CHECK (${expr})`);
  }
  let table = `CREATE TABLE ${q(e.tableName)} (${defs.join(', ')})`;
  if (e.options.withoutRowid) table += ' WITHOUT ROWID';
  if (e.options.strict) table += e.options.withoutRowid ? ', STRICT' : ' STRICT';
  const out = [table];
  for (const [key, spec] of live) {
    if (!spec.index) continue;
    const name = typeof spec.index === 'string' ? spec.index : `idx_${e.tableName}_${sqlName(key, spec)}`;
    out.push(`CREATE INDEX ${q(name)} ON ${q(e.tableName)} (${q(sqlName(key, spec))})`);
  }
  for (const raw of e.options.indexes ?? []) {
    const idx = Array.isArray(raw) ? { columns: raw as string[] } : (raw as { columns: string[]; name?: string; unique?: boolean; where?: string });
    const cols = idx.columns.map((k) => e.sqlColumnName(k));
    const name = idx.name ?? `${idx.unique ? 'uidx' : 'idx'}_${e.tableName}_${cols.join('_')}`;
    let s = `CREATE ${idx.unique ? 'UNIQUE ' : ''}INDEX ${q(name)} ON ${q(e.tableName)} (${cols.map(q).join(', ')})`;
    if (idx.where) s += ` WHERE ${idx.where}`;
    out.push(s);
  }
  return out;
}
