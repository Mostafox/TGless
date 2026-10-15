import type { Entity } from '../db/entity.js';
import type { Provider, Token } from './di.js';
import type { Endpoint, EndpointContext } from './endpoint.js';
import type { CommandContext, CommandRoute, Guard, Handler, Middleware, Route } from './routes.js';
import type { Scene } from './scene.js';
import type { Awaitable } from './routes.js';

export interface ModuleDefinition {
  /** Used in error messages and by tooling. */
  name?: string;
  /** Modules whose exported providers this module can inject. */
  imports?: Module[];
  providers?: Provider[];
  /** Providers (tokens) other modules may inject when they import this one. */
  exports?: Token[];
  /** Make exported providers visible to every module without importing. */
  global?: boolean;
  /**
   * Entities owned by this module. Any `entity()` imported by the app is
   * included in the schema anyway; listing them documents ownership.
   */
  entities?: Entity<any, any>[];

  /** `{ start: handler }` (key = command name) or `[command('start', h), ...]`. */
  commands?: Record<string, Handler<CommandContext> | CommandRoute> | CommandRoute[];
  callbacks?: Route[];
  hears?: Route[];
  on?: Route[];
  inline?: Route[];
  /** Any routes (commands, callbacks, hears, on, inline) in one list. */
  routes?: Route[];
  scenes?: Scene[];
  /** Mini App endpoints: `{ getProfile }` → `POST /api/getProfile`. A bare function is fine too. */
  endpoints?: Record<string, Endpoint | ((ctx: EndpointContext) => Awaitable<unknown>)>;

  /** Run around every route of this module. */
  middlewares?: Middleware<any>[];
  /** Checked before every route of this module. */
  guards?: Guard[];
}

export interface Module extends ModuleDefinition {
  readonly __module: true;
  name: string;
}

let counter = 0;

/**
 * A feature module: routes + providers + entities.
 *
 * ```ts
 * export const ShopModule = defineModule({
 *   name: 'shop',
 *   imports: [UsersModule],
 *   providers: [CartService],
 *   commands: { shop: openShop },
 *   callbacks: [addToCart],
 *   endpoints: { getCart },
 * })
 * ```
 */
export function defineModule(def: ModuleDefinition): Module {
  return { ...def, name: def.name ?? `module${++counter}`, __module: true };
}
