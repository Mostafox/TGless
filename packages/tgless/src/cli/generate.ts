import fs from 'node:fs';
import path from 'node:path';
import { CliError, color, log } from './log.js';

export const GENERATORS = ['module', 'command', 'callback', 'hears', 'entity', 'service', 'endpoint', 'scene'] as const;
export type GeneratorKind = (typeof GENERATORS)[number];

const words = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
export const pascal = (s: string) => words(s).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
export const camel = (s: string) => {
  const p = pascal(s);
  return p[0].toLowerCase() + p.slice(1);
};
export const kebab = (s: string) => words(s).join('-');
export const snake = (s: string) => words(s).join('_');
const plural = (s: string) => (/(s|x|ch|sh)$/.test(s) ? `${s}es` : /[^aeiou]y$/.test(s) ? `${s.slice(0, -1)}ies` : `${s}s`);

interface Ctx {
  root: string;
  srcDir: string;
  dryRun?: boolean;
  created: string[];
  updated: string[];
}

function writeNew(ctx: Ctx, file: string, contents: string) {
  if (fs.existsSync(file)) throw new CliError(`${path.relative(ctx.root, file)} already exists.`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  ctx.created.push(path.relative(ctx.root, file).split(path.sep).join('/'));
}

/** Find the `[`/`{` that follows `prop:` and insert `item` before its closing bracket. */
export function insertIntoLiteral(source: string, prop: string, item: string, open: '[' | '{'): string | undefined {
  const close = open === '[' ? ']' : '}';
  const re = new RegExp(`\\b${prop}\\s*:\\s*\\${open}`);
  const m = re.exec(source);
  if (!m) return undefined;
  let depth = 0;
  let i = m.index + m[0].length - 1;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === '[' || ch === '{' || ch === '(') depth++;
    else if (ch === ']' || ch === '}' || ch === ')') {
      depth--;
      if (depth === 0) break;
    }
  }
  if (i >= source.length || source[i] !== close) return undefined;
  const inner = source.slice(m.index + m[0].length, i);
  if (!inner.trim()) return source.slice(0, i) + item + source.slice(i);
  const trimmed = inner.replace(/\s+$/, '');
  const sep = trimmed.endsWith(',') ? ' ' : ', ';
  const multiline = inner.includes('\n');
  if (multiline) {
    const indent = /\n(\s*)\S/.exec(inner)?.[1] ?? '    ';
    const before = source.slice(0, m.index + m[0].length) + trimmed + (trimmed.endsWith(',') ? '' : ',');
    return `${before}\n${indent}${item},${inner.slice(trimmed.length)}${source.slice(i)}`;
  }
  return source.slice(0, m.index + m[0].length) + trimmed + sep + item + inner.slice(trimmed.length) + source.slice(i);
}

/** Add `prop: <open>item<close>` to the object passed to `call(`, or insert into the existing literal. */
function register(source: string, call: string, prop: string, item: string, open: '[' | '{'): string {
  const inserted = insertIntoLiteral(source, prop, item, open);
  if (inserted) return inserted;
  const anchor = new RegExp(`${call}\\(\\{`);
  const m = anchor.exec(source);
  if (!m) throw new CliError(`Could not find ${call}({ ... }) to register "${item}". Add it manually.`);
  const at = m.index + m[0].length;
  const value = open === '[' ? `[${item}]` : `{ ${item} }`;
  return `${source.slice(0, at)}\n  ${prop}: ${value},${source.slice(at)}`;
}

function addImport(source: string, line: string): string {
  if (source.includes(line)) return source;
  const imports = [...source.matchAll(/^import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm)];
  if (!imports.length) return `${line}\n${source}`;
  const last = imports[imports.length - 1];
  const at = last.index! + last[0].length;
  return `${source.slice(0, at)}\n${line}${source.slice(at)}`;
}

function update(ctx: Ctx, file: string, fn: (s: string) => string) {
  const before = fs.readFileSync(file, 'utf8');
  const after = fn(before);
  if (after !== before) {
    fs.writeFileSync(file, after);
    ctx.updated.push(path.relative(ctx.root, file).split(path.sep).join('/'));
  }
}

function moduleFile(ctx: Ctx, name: string) {
  return path.join(ctx.srcDir, 'modules', kebab(name), `${kebab(name)}.module.ts`);
}

function listModules(ctx: Ctx): string[] {
  const dir = path.join(ctx.srcDir, 'modules');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((d) => fs.existsSync(path.join(dir, d, `${d}.module.ts`)));
}

function pickModule(ctx: Ctx, requested?: string): string {
  const modules = listModules(ctx);
  if (requested) {
    if (!modules.includes(kebab(requested))) {
      throw new CliError(`Module "${requested}" not found. Create it first: tgless g module ${requested}`);
    }
    return kebab(requested);
  }
  if (modules.length === 1) return modules[0];
  if (!modules.length) throw new CliError('No modules yet. Create one: tgless g module <name>');
  throw new CliError(`Which module? Pass --module <name> (one of: ${modules.join(', ')}).`);
}

// ───────────────────────────── entity fields ─────────────────────────────

const FIELD_TYPES: Record<string, string> = {
  text: 'c.text()',
  string: 'c.text()',
  int: 'c.int()',
  integer: 'c.int()',
  real: 'c.real()',
  float: 'c.real()',
  number: 'c.real()',
  numeric: 'c.numeric()',
  bool: 'c.bool()',
  boolean: 'c.bool()',
  json: 'c.json()',
  date: 'c.date()',
  datems: 'c.dateMs()',
  blob: 'c.blob()',
  enum: 'c.enum',
};

/**
 * Parse one field: `name:type[(a|b)][?!#][=default]`.
 * `?` optional, `!` unique, `#` index, `=x` default. `enum(a|b)` for enums.
 */
export function fieldToCode(spec: string): { key: string; code: string } {
  const m = /^([A-Za-z_]\w*):([A-Za-z]+)(?:\(([^)]*)\))?([?!#]*)(?:=(.*))?$/.exec(spec.trim());
  if (!m) {
    throw new CliError(
      `Bad field "${spec}". Use name:type[?!#][=default], e.g. price:real=0, email:text!?, status:enum(new|paid)=new`,
    );
  }
  const [, key, rawType, args, mods, def] = m;
  const type = rawType.toLowerCase();
  const base = FIELD_TYPES[type];
  if (!base) throw new CliError(`Unknown field type "${rawType}" in "${spec}". One of: ${Object.keys(FIELD_TYPES).join(', ')}`);
  let code = base;
  if (type === 'enum') {
    const values = (args ?? '')
      .split('|')
      .map((v) => v.trim())
      .filter(Boolean);
    if (!values.length) throw new CliError(`enum needs values: ${key}:enum(a|b)`);
    code = `c.enum([${values.map((v) => `'${v}'`).join(', ')}])`;
  }
  if (mods.includes('!')) code += '.unique()';
  if (mods.includes('#')) code += '.index()';
  if (mods.includes('?')) code += '.optional()';
  if (def !== undefined) code += defaultCode(type, def, spec);
  return { key, code };
}

function defaultCode(type: string, raw: string, spec: string): string {
  const v = raw.trim();
  switch (type) {
    case 'text':
    case 'string':
    case 'enum':
      return `.default(${/^(['"]).*\1$/.test(v) ? v : `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`})`;
    case 'bool':
    case 'boolean':
      if (v !== 'true' && v !== 'false') throw new CliError(`Default for "${spec}" must be true or false.`);
      return `.default(${v})`;
    case 'date':
    case 'datems':
      if (v !== 'now') throw new CliError(`Date default for "${spec}" can only be "now".`);
      return `.defaultSql('(unixepoch())')`;
    case 'json':
      return `.default(${v})`;
    default:
      if (v === '' || Number.isNaN(Number(v))) throw new CliError(`Default for "${spec}" must be a number.`);
      return `.default(${v})`;
  }
}

/** `product:title:text,price:real` → `{ name: 'product', fields: ['title:text', 'price:real'] }` */
export function parseEntitySpec(spec: string): { name: string; fields: string[] } {
  const i = spec.indexOf(':');
  if (i < 0) return { name: spec.trim(), fields: [] };
  return {
    name: spec.slice(0, i).trim(),
    fields: spec
      .slice(i + 1)
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean),
  };
}

// ───────────────────────────── generators ─────────────────────────────

/** Pieces to add to a module in one go (`tgless g module shop --commands a,b --entity …`). */
export interface ModuleSpec {
  commands?: string[];
  /** `name` or `name/:param/:param`. */
  callbacks?: string[];
  hears?: string[];
  /** `name:field:type,field:type` each. */
  entities?: string[];
  services?: string[];
  endpoints?: string[];
  scenes?: string[];
  /** Other modules (by name) to import. */
  imports?: string[];
}

export interface GenerateOptions {
  module?: string;
  root: string;
  entry: string;
  /** Extra pieces for `g module`. */
  spec?: ModuleSpec;
  /** Fields for `g entity` (`title:text,price:real`). */
  fields?: string;
}

type PieceKind = Exclude<GeneratorKind, 'module'>;

/** Split repeatable `a,b c` list flags into items. */
export function splitList(values: string[] | undefined, sep: RegExp = /[,\s]+/): string[] {
  return (values ?? [])
    .flatMap((v) => v.split(sep))
    .map((v) => v.trim())
    .filter(Boolean);
}

export function generate(kind: GeneratorKind, rawName: string, opts: GenerateOptions) {
  if (!rawName) {
    throw new CliError(
      `Usage: tgless g ${kind} <name>${kind === 'module' ? ' [--commands a,b --callbacks x/:id --entity "item:title:text" …]' : ' [--module <module>]'}`,
    );
  }
  const entryPath = path.resolve(opts.root, opts.entry);
  const ctx: Ctx = { root: opts.root, srcDir: path.dirname(entryPath), created: [], updated: [] };

  if (kind === 'module') {
    const name = kebab(rawName);
    const spec = opts.spec ?? {};
    const file = moduleFile(ctx, name);
    const exists = fs.existsSync(file);
    const hasPieces = Object.values(spec).some((v) => v?.length);
    if (exists && !hasPieces) throw new CliError(`${path.relative(ctx.root, file)} already exists. Pass pieces (--commands, --entity, …) to add to it.`);
    if (!exists) createModule(ctx, name, entryPath);
    for (const imp of spec.imports ?? []) addModuleImport(ctx, name, imp);
    const pieces: [PieceKind, string[]][] = [
      ['entity', spec.entities ?? []],
      ['service', spec.services ?? []],
      ['command', spec.commands ?? []],
      ['callback', spec.callbacks ?? []],
      ['hears', spec.hears ?? []],
      ['endpoint', spec.endpoints ?? []],
      ['scene', spec.scenes ?? []],
    ];
    for (const [k, items] of pieces) for (const item of items) generatePiece(ctx, k, item, name);
    return report(ctx);
  }

  const mod = pickModule(ctx, opts.module);
  // `g entity product --fields a:text` or `g entity "product:a:text"`; other kinds accept `a,b,c`.
  const items = kind === 'entity' ? [opts.fields ? `${rawName}:${opts.fields}` : rawName] : splitList([rawName]);
  for (const item of items) generatePiece(ctx, kind, item, mod);
  report(ctx);
}

function createModule(ctx: Ctx, name: string, entryPath: string) {
  const exportName = `${pascal(name)}Module`;
  writeNew(
    ctx,
    moduleFile(ctx, name),
    `import { defineModule } from 'tglessjs';

export const ${exportName} = defineModule({
  name: '${name}',
  imports: [],
  providers: [],
  entities: [],
  commands: [],
  callbacks: [],
  endpoints: {},
});
`,
  );
  if (fs.existsSync(entryPath)) {
    update(ctx, entryPath, (s) =>
      register(addImport(s, `import { ${exportName} } from './modules/${name}/${name}.module';`), 'createApp', 'modules', exportName, '['),
    );
  }
}

function addModuleImport(ctx: Ctx, mod: string, other: string) {
  const target = kebab(other);
  if (!fs.existsSync(moduleFile(ctx, target))) {
    throw new CliError(`Cannot import module "${other}": src/modules/${target}/${target}.module.ts not found.`);
  }
  const exportName = `${pascal(target)}Module`;
  update(ctx, moduleFile(ctx, mod), (s) =>
    register(addImport(s, `import { ${exportName} } from '../${target}/${target}.module';`), 'defineModule', 'imports', exportName, '['),
  );
}

function generatePiece(ctx: Ctx, kind: PieceKind, rawName: string, mod: string) {
  const modDir = path.join(ctx.srcDir, 'modules', mod);
  const modFile = path.join(modDir, `${mod}.module.ts`);
  const reg = (prop: string, exportName: string, rel: string, open: '[' | '{' = '[') =>
    update(ctx, modFile, (s) => register(addImport(s, `import { ${exportName} } from '${rel}';`), 'defineModule', prop, exportName, open));

  switch (kind) {
    case 'command': {
      const name = rawName.replace(/^\//, '');
      const cmd = snake(name);
      const exportName = `${camel(name)}Command`;
      writeNew(
        ctx,
        path.join(modDir, 'commands', `${kebab(name)}.command.ts`),
        `import { command } from 'tglessjs';

export const ${exportName} = command('${cmd}', { description: '${pascal(name)}' }, async (ctx) => {
  await ctx.reply('/${cmd} works!');
});
`,
      );
      reg('commands', exportName, `./commands/${kebab(name)}.command`);
      break;
    }
    case 'callback': {
      // `add/:id` → pattern `<module>:add/:id` with params { id }; `refresh` → no params.
      const [base, ...rest] = rawName.split('/');
      const params = rest.map((p) => p.replace(/^:/, '')).filter(Boolean);
      const exportName = `${camel(base)}Callback`;
      const pattern = [`${mod}:${kebab(base)}`, ...params.map((p) => `:${p}`)].join('/');
      const example = params.length ? `{ ${params.map((p) => `${p}: 1`).join(', ')} }` : '';
      const body = params.length
        ? `await ctx.answer(\`${params.map((p) => `${p}=\${ctx.params.${p}}`).join(' ')}\`);`
        : `await ctx.answer('Done');`;
      writeNew(
        ctx,
        path.join(modDir, 'callbacks', `${kebab(base)}.callback.ts`),
        `import { callback } from 'tglessjs';

// Button: inline().text('Label', ${exportName}.data(${example}))
export const ${exportName} = callback('${pattern}', async (ctx) => {
  ${body}
});
`,
      );
      reg('callbacks', exportName, `./callbacks/${kebab(base)}.callback`);
      break;
    }
    case 'hears': {
      const exportName = `${camel(rawName)}Hears`;
      writeNew(
        ctx,
        path.join(modDir, 'hears', `${kebab(rawName)}.hears.ts`),
        `import { hears } from 'tglessjs';

export const ${exportName} = hears(/^${words(rawName).join(' ')}$/i, async (ctx) => {
  await ctx.reply('Heard you!');
});
`,
      );
      reg('routes', exportName, `./hears/${kebab(rawName)}.hears`);
      break;
    }
    case 'entity': {
      const { name, fields } = parseEntitySpec(rawName);
      const exportName = pascal(plural(camel(name)));
      const table = snake(plural(camel(name)));
      const parsed = (fields.length ? fields : ['name:text']).map(fieldToCode);
      const keys = new Set(parsed.map((f) => f.key));
      const lines = [
        ...(keys.has('id') ? [] : ['  id: c.id(),']),
        ...parsed.map((f) => `  ${f.key}: ${f.code},`),
        ...(keys.has('createdAt') || keys.has('updatedAt') ? [] : ['  ...c.timestamps(),']),
      ];
      writeNew(
        ctx,
        path.join(modDir, 'entities', `${kebab(name)}.entity.ts`),
        `import { c, entity, type Infer } from 'tglessjs/db';

export const ${exportName} = entity('${table}', {
${lines.join('\n')}
});

export type ${pascal(name)} = Infer<typeof ${exportName}>;
`,
      );
      reg('entities', exportName, `./entities/${kebab(name)}.entity`);
      break;
    }
    case 'service': {
      const exportName = `${pascal(rawName)}Service`;
      writeNew(
        ctx,
        path.join(modDir, 'services', `${kebab(rawName)}.service.ts`),
        `// Inject dependencies with field initializers: \`private other = inject(OtherService);\`
export class ${exportName} {
  hello(name: string) {
    return \`Hello, \${name}!\`;
  }
}
`,
      );
      reg('providers', exportName, `./services/${kebab(rawName)}.service`);
      break;
    }
    case 'endpoint': {
      const exportName = camel(rawName);
      writeNew(
        ctx,
        path.join(modDir, 'endpoints', `${kebab(rawName)}.endpoint.ts`),
        `import { endpoint } from 'tglessjs';

// Mini App: Telegram.WebApp.Serverless.call('${exportName}', input, (err, result) => ...)
export const ${exportName} = endpoint(async (ctx) => {
  return { hello: ctx.user.first_name, input: ctx.input };
});
`,
      );
      reg('endpoints', exportName, `./endpoints/${kebab(rawName)}.endpoint`, '{');
      break;
    }
    case 'scene': {
      const exportName = `${camel(rawName)}Scene`;
      writeNew(
        ctx,
        path.join(modDir, 'scenes', `${kebab(rawName)}.scene.ts`),
        `import { scene } from 'tglessjs';

interface State {
  answer?: string;
}

// Start with: await ctx.scene.enter('${kebab(rawName)}')
export const ${exportName} = scene<State>('${kebab(rawName)}', [
  async (ctx) => {
    await ctx.reply('Question? (send /cancel to stop)');
    ctx.scene.next();
  },
  async (ctx) => {
    if (!ctx.text) return ctx.reply('Please answer with text.');
    ctx.scene.state.answer = ctx.text;
    await ctx.reply(\`Got it: \${ctx.text}\`);
    ctx.scene.leave();
  },
]);
`,
      );
      reg('scenes', exportName, `./scenes/${kebab(rawName)}.scene`);
      break;
    }
  }
}

function report(ctx: Ctx) {
  for (const f of ctx.created) log.info(`  ${color.green('create')} ${f}`);
  for (const f of ctx.updated) log.info(`  ${color.blue('update')} ${f}`);
}
