/**
 * Operators for repository `where` objects:
 *
 * ```ts
 * Users.findMany({ where: { age: gte(18), name: like('A%'), id: inArray([1, 2]) } })
 * ```
 *
 * They are plain descriptors, translated to `sdk/db` operators at query time.
 */

export type OpName =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'like'
  | 'notLike'
  | 'inArray'
  | 'notInArray'
  | 'between'
  | 'notBetween'
  | 'isNull'
  | 'isNotNull';

export interface Op<T = unknown> {
  readonly __op: OpName;
  readonly value?: unknown;
  readonly value2?: unknown;
  /** Phantom: the column type this operator applies to. */
  readonly __t?: T;
}

const op = <T>(name: OpName, value?: unknown, value2?: unknown): Op<T> => ({ __op: name, value, value2 });

export const eq = <T>(v: T) => op<T>('eq', v);
export const ne = <T>(v: T) => op<T>('ne', v);
export const gt = <T>(v: T) => op<T>('gt', v);
export const gte = <T>(v: T) => op<T>('gte', v);
export const lt = <T>(v: T) => op<T>('lt', v);
export const lte = <T>(v: T) => op<T>('lte', v);
export const like = (pattern: string) => op<string>('like', pattern);
export const notLike = (pattern: string) => op<string>('notLike', pattern);
export const inArray = <T>(values: readonly T[]) => op<T>('inArray', values);
export const notInArray = <T>(values: readonly T[]) => op<T>('notInArray', values);
export const between = <T>(min: T, max: T) => op<T>('between', min, max);
export const notBetween = <T>(min: T, max: T) => op<T>('notBetween', min, max);
export const isNull = () => op<any>('isNull');
export const isNotNull = () => op<any>('isNotNull');

/** Case-insensitive "contains" helper: `name: contains('ali')`. */
export const contains = (s: string) => like(`%${s}%`);
export const startsWith = (s: string) => like(`${s}%`);
export const endsWith = (s: string) => like(`%${s}`);

export function isOp(v: unknown): v is Op {
  return typeof v === 'object' && v !== null && '__op' in v;
}
