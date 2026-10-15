/**
 * A tiny dependency-injection container.
 *
 * - Classes are their own tokens: `providers: [UsersService]`.
 * - Values/factories use a token: `{ provide: CONFIG, useValue: {...} }`.
 * - Dependencies are pulled with `inject(Token)` inside field initializers or
 *   constructors (Angular-style). No decorators, no reflect-metadata.
 * - Providers are singletons per app instance (one per V8 isolate on tgcloud).
 */

export type Class<T = any> = new (...args: any[]) => T;

/** A typed token for non-class providers. */
export class InjectionToken<T> {
  declare readonly __type?: T;
  constructor(readonly description: string) {}
  toString() {
    return `InjectionToken(${this.description})`;
  }
}

export type Token<T = any> = Class<T> | InjectionToken<T>;

export type Provider<T = any> =
  | Class<T>
  | { provide: Token<T>; useValue: T }
  | { provide: Token<T>; useClass: Class<T> }
  | { provide: Token<T>; useFactory: (...deps: any[]) => T; inject?: Token[] }
  | { provide: Token<T>; useExisting: Token<T> };

export function tokenName(token: Token): string {
  return token instanceof InjectionToken ? token.toString() : token?.name ?? String(token);
}

export function providerToken(p: Provider): Token {
  return typeof p === 'function' ? p : p.provide;
}

interface Resolver {
  resolve<T>(token: Token<T>, optional?: boolean): T | undefined;
}

let current: Resolver | null = null;

/**
 * Resolve a dependency. Valid while a provider is being constructed, or inside
 * `runInInjectionContext`. In handlers use `ctx.inject(Token)` instead.
 */
export function inject<T>(token: Token<T>): T;
export function inject<T>(token: Token<T>, opts: { optional: true }): T | undefined;
export function inject<T>(token: Token<T>, opts?: { optional?: boolean }): T | undefined {
  if (!current) {
    throw new Error(
      `inject(${tokenName(token)}) called outside an injection context. ` +
        `Use it in a provider's field initializer/constructor, or use ctx.inject() in handlers.`,
    );
  }
  return current.resolve(token, opts?.optional);
}

export function runInInjectionContext<T>(resolver: Resolver, fn: () => T): T {
  const prev = current;
  current = resolver;
  try {
    return fn();
  } finally {
    current = prev;
  }
}

/**
 * One container per module. A module sees its own providers plus the exports of
 * the modules it imports, plus every global module's exports.
 */
export class Container implements Resolver {
  private readonly providers = new Map<Token, Provider>();
  private readonly instances = new Map<Token, unknown>();
  private readonly resolving = new Set<Token>();
  /** Containers whose exported tokens are visible here (imports + globals). */
  readonly imports: Container[] = [];
  readonly exported = new Set<Token>();

  constructor(
    readonly name: string,
    private readonly fallback?: Container,
  ) {}

  register(provider: Provider) {
    this.providers.set(providerToken(provider), provider);
  }

  has(token: Token): boolean {
    return this.providers.has(token);
  }

  /** Find the container that owns `token` and may hand it to us. */
  private owner(token: Token, seen = new Set<Container>()): Container | undefined {
    if (this.providers.has(token)) return this;
    for (const imp of this.imports) {
      if (seen.has(imp)) continue;
      seen.add(imp);
      if (imp.exported.has(token)) {
        const found = imp.owner(token, seen);
        if (found) return found;
      }
    }
    return undefined;
  }

  resolve<T>(token: Token<T>, optional = false): T | undefined {
    const owner = this.owner(token) ?? this.fallback?.ownerOf(token);
    if (!owner) {
      if (optional) return undefined;
      throw new Error(
        `No provider for ${tokenName(token)} in module "${this.name}". ` +
          `Add it to the module's providers, or import a module that exports it.`,
      );
    }
    return owner.instantiate(token) as T;
  }

  /** Public lookup used by the root fallback (global providers). */
  ownerOf(token: Token): Container | undefined {
    return this.owner(token);
  }

  private instantiate(token: Token): unknown {
    if (this.instances.has(token)) return this.instances.get(token);
    if (this.resolving.has(token)) {
      throw new Error(`Circular dependency while resolving ${tokenName(token)} in "${this.name}".`);
    }
    const provider = this.providers.get(token)!;
    this.resolving.add(token);
    try {
      const value = runInInjectionContext(this, () => this.create(provider));
      this.instances.set(token, value);
      return value;
    } finally {
      this.resolving.delete(token);
    }
  }

  private create(p: Provider): unknown {
    if (typeof p === 'function') return new p();
    if ('useValue' in p) return p.useValue;
    if ('useClass' in p) return new p.useClass();
    if ('useExisting' in p) return this.resolve(p.useExisting);
    return p.useFactory(...(p.inject ?? []).map((t) => this.resolve(t)));
  }

  /** Override a provider (tests). Clears any cached instance. */
  override(token: Token, provider: Provider) {
    this.providers.set(token, provider);
    this.instances.delete(token);
  }
}
