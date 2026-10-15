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

export interface GenerateOptions {
  module?: string;
  root: string;
  entry: string;
}

export function generate(kind: GeneratorKind, rawName: string, opts: GenerateOptions) {
  if (!rawName) throw new CliError(`Usage: tgless g ${kind} <name>${kind === 'module' ? '' : ' [--module <module>]'}`);
  const entryPath = path.resolve(opts.root, opts.entry);
  const ctx: Ctx = { root: opts.root, srcDir: path.dirname(entryPath), created: [], updated: [] };
  const name = rawName;

  if (kind === 'module') {
    const file = moduleFile(ctx, name);
    const exportName = `${pascal(name)}Module`;
    writeNew(
      ctx,
      file,
      `import { defineModule } from 'tgless';

export const ${exportName} = defineModule({
  name: '${kebab(name)}',
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
        register(
          addImport(s, `import { ${exportName} } from './modules/${kebab(name)}/${kebab(name)}.module';`),
          'createApp',
          'modules',
          exportName,
          '[',
        ),
      );
    }
    return report(ctx);
  }

  const mod = pickModule(ctx, opts.module);
  const modDir = path.join(ctx.srcDir, 'modules', mod);
  const modFile = path.join(modDir, `${mod}.module.ts`);
  const reg = (prop: string, exportName: string, rel: string, open: '[' | '{' = '[') =>
    update(ctx, modFile, (s) => register(addImport(s, `import { ${exportName} } from '${rel}';`), 'defineModule', prop, exportName, open));

  switch (kind) {
    case 'command': {
      const cmd = snake(name);
      const exportName = `${camel(name)}Command`;
      writeNew(
        ctx,
        path.join(modDir, 'commands', `${kebab(name)}.command.ts`),
        `import { command } from 'tgless';

export const ${exportName} = command('${cmd}', { description: '${pascal(name)}' }, async (ctx) => {
  await ctx.reply('/${cmd} works!');
});
`,
      );
      reg('commands', exportName, `./commands/${kebab(name)}.command`);
      break;
    }
    case 'callback': {
      const exportName = `${camel(name)}Callback`;
      writeNew(
        ctx,
        path.join(modDir, 'callbacks', `${kebab(name)}.callback.ts`),
        `import { callback } from 'tgless';

// Build button data with: inline().text('Label', ${exportName}.data({ id: 1 }))
export const ${exportName} = callback('${mod}:${kebab(name)}/:id', async (ctx) => {
  await ctx.answer(\`id = \${ctx.params.id}\`);
});
`,
      );
      reg('callbacks', exportName, `./callbacks/${kebab(name)}.callback`);
      break;
    }
    case 'hears': {
      const exportName = `${camel(name)}Hears`;
      writeNew(
        ctx,
        path.join(modDir, 'hears', `${kebab(name)}.hears.ts`),
        `import { hears } from 'tgless';

export const ${exportName} = hears(/^${words(name).join(' ')}$/i, async (ctx) => {
  await ctx.reply('Heard you!');
});
`,
      );
      reg('routes', exportName, `./hears/${kebab(name)}.hears`);
      break;
    }
    case 'entity': {
      const exportName = pascal(plural(camel(name)));
      const table = snake(plural(camel(name)));
      writeNew(
        ctx,
        path.join(modDir, 'entities', `${kebab(name)}.entity.ts`),
        `import { c, entity, type Infer } from 'tgless/db';

export const ${exportName} = entity('${table}', {
  id: c.id(),
  name: c.text(),
  ...c.timestamps(),
});

export type ${pascal(name)} = Infer<typeof ${exportName}>;
`,
      );
      reg('entities', exportName, `./entities/${kebab(name)}.entity`);
      break;
    }
    case 'service': {
      const exportName = `${pascal(name)}Service`;
      writeNew(
        ctx,
        path.join(modDir, 'services', `${kebab(name)}.service.ts`),
        `// Inject dependencies with field initializers: \`private other = inject(OtherService);\`
export class ${exportName} {
  hello(name: string) {
    return \`Hello, \${name}!\`;
  }
}
`,
      );
      reg('providers', exportName, `./services/${kebab(name)}.service`);
      break;
    }
    case 'endpoint': {
      const exportName = camel(name);
      writeNew(
        ctx,
        path.join(modDir, 'endpoints', `${kebab(name)}.endpoint.ts`),
        `import { endpoint } from 'tgless';

// Mini App: Telegram.WebApp.Serverless.call('${exportName}', input, (err, result) => ...)
export const ${exportName} = endpoint(async (ctx) => {
  return { hello: ctx.user.first_name, input: ctx.input };
});
`,
      );
      reg('endpoints', exportName, `./endpoints/${kebab(name)}.endpoint`, '{');
      break;
    }
    case 'scene': {
      const exportName = `${camel(name)}Scene`;
      writeNew(
        ctx,
        path.join(modDir, 'scenes', `${kebab(name)}.scene.ts`),
        `import { scene } from 'tgless';

interface State {
  answer?: string;
}

// Start with: await ctx.scene.enter('${kebab(name)}')
export const ${exportName} = scene<State>('${kebab(name)}', [
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
      reg('scenes', exportName, `./scenes/${kebab(name)}.scene`);
      break;
    }
  }
  report(ctx);
}

function report(ctx: Ctx) {
  for (const f of ctx.created) log.info(`  ${color.green('create')} ${f}`);
  for (const f of ctx.updated) log.info(`  ${color.blue('update')} ${f}`);
}
