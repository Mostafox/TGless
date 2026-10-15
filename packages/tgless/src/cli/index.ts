import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildProject } from './build.js';
import { findRoot, loadConfig, type ResolvedConfig } from './config.js';
import { addPackages, checkAllDeps } from './deps.js';
import { doctor } from './doctor.js';
import { GENERATORS, type GeneratorKind, generate, splitList } from './generate.js';
import { CliError, color, log } from './log.js';
import { runTgcloud } from './tgcloud.js';

const HELP = `
${color.bold('tgless')} — TypeScript framework for Telegram Serverless (tgcloud)

${color.bold('Usage')}
  tgless build                     Compile src/ into tgcloud/ (schema.js, lib/, handlers/, endpoints/)
  tgless dev [--push]              Rebuild on change (and \`tgcloud push\` after each build)
  tgless deploy [--migrate]        Build, then \`tgcloud push\` (and \`tgcloud migrate\`)
  tgless migrate [args]            Build, then \`tgcloud migrate\` (args are passed through)
  tgless run <module> [json] [...] Build, then \`tgcloud run\` (e.g. tgless run endpoints/getCart '{}')
  tgless g <kind> <name>[,<name>…] [--module <m>]
                                   Generate: ${GENERATORS.join(', ')}
  tgless g module <name> [pieces]  Create (or extend) a whole module in one command:
      --commands start,help        --callbacks add/:id,refresh   --hears thanks
      --entity "product:title:text,price:real=0,sku:text!,status:enum(draft|live)=draft,note:text?"
      --services cart              --endpoints getCart           --scenes checkout
      --imports users              (field mods: ? optional, ! unique, # index, =default)
  tgless add <pkg...> [--dev]      npm install + check the package can be bundled for tgcloud
  tgless deps                      Check all dependencies can be bundled
  tgless commands                  List bot commands that have a description
  tgless doctor                    Check the project setup

${color.bold('Options')}
  --root <dir>                     Project root (default: nearest package.json)
  -h, --help                       Show help
  -v, --version                    Show version
`;

function version(): string {
  const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
  return JSON.parse(fs.readFileSync(pkg, 'utf8')).version;
}

async function config(root?: string): Promise<ResolvedConfig> {
  return loadConfig(root ? path.resolve(root) : findRoot());
}

/** Split argv at `--` (everything after is passed to tgcloud). */
function splitPassthrough(argv: string[]): [string[], string[]] {
  const i = argv.indexOf('--');
  return i < 0 ? [argv, []] : [argv.slice(0, i), argv.slice(i + 1)];
}

async function exitWith(code: Promise<number>) {
  const c = await code;
  if (c !== 0) process.exitCode = c;
}

async function dev(cfg: ResolvedConfig, push: boolean) {
  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let queued = false;
  const rebuild = async () => {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      log.step(`Building… ${color.dim(new Date().toLocaleTimeString())}`);
      await buildProject(cfg);
      if (push) await runTgcloud(cfg.root, ['push']);
    } catch (e) {
      log.error(e instanceof CliError ? e.message : ((e as Error)?.stack ?? String(e)));
    } finally {
      running = false;
      if (queued) {
        queued = false;
        void rebuild();
      }
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(rebuild, 150);
  };
  await rebuild();
  const srcDir = path.dirname(cfg.entryPath);
  fs.watch(srcDir, { recursive: true }, schedule);
  for (const f of fs.readdirSync(cfg.root)) {
    if (/^tgless\.config\.|^package\.json$/.test(f)) fs.watch(path.join(cfg.root, f), schedule);
  }
  log.info(color.dim(`Watching ${path.relative(cfg.root, srcDir) || '.'} for changes… (Ctrl+C to stop)`));
  await new Promise(() => {});
}

export async function main(argv: string[]) {
  const [ours, passthrough] = splitPassthrough(argv);
  const { values, positionals } = parseArgs({
    args: ours,
    allowPositionals: true,
    strict: false,
    options: {
      root: { type: 'string' },
      module: { type: 'string', short: 'm' },
      push: { type: 'boolean' },
      migrate: { type: 'boolean' },
      dev: { type: 'boolean', short: 'D' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      // `tgless g module` pieces (repeatable; comma-separated)
      commands: { type: 'string', multiple: true },
      callbacks: { type: 'string', multiple: true },
      hears: { type: 'string', multiple: true },
      entity: { type: 'string', multiple: true },
      services: { type: 'string', multiple: true },
      endpoints: { type: 'string', multiple: true },
      scenes: { type: 'string', multiple: true },
      imports: { type: 'string', multiple: true },
      fields: { type: 'string' },
    },
  });
  const [cmd, ...rest] = positionals;
  const root = values.root as string | undefined;
  /** Raw args after the command name (minus --root), for commands that forward to tgcloud. */
  const raw = (() => {
    const i = ours.indexOf(cmd);
    const out: string[] = [];
    const after = i < 0 ? [] : ours.slice(i + 1);
    for (let j = 0; j < after.length; j++) {
      if (after[j] === '--root') j++;
      else if (!after[j].startsWith('--root=')) out.push(after[j]);
    }
    return out;
  })();

  try {
    if (values.version) return log.info(version());
    if (!cmd || values.help || cmd === 'help') return log.info(HELP);

    switch (cmd) {
      case 'build': {
        await buildProject(await config(root));
        return;
      }
      case 'dev':
        return await dev(await config(root), !!values.push);
      case 'deploy': {
        const cfg = await config(root);
        await buildProject(cfg);
        const code = await runTgcloud(cfg.root, ['push', ...passthrough]);
        if (code !== 0) return void (process.exitCode = code);
        if (values.migrate) await exitWith(runTgcloud(cfg.root, ['migrate']));
        return;
      }
      case 'migrate': {
        const cfg = await config(root);
        await buildProject(cfg, { quiet: true });
        return await exitWith(runTgcloud(cfg.root, ['migrate', ...raw, ...passthrough]));
      }
      case 'run': {
        const cfg = await config(root);
        await buildProject(cfg, { quiet: true });
        return await exitWith(runTgcloud(cfg.root, ['run', ...raw, ...passthrough]));
      }
      case 'g':
      case 'generate': {
        const [kind, name] = rest;
        if (!GENERATORS.includes(kind as GeneratorKind)) {
          throw new CliError(`Unknown generator "${kind ?? ''}". One of: ${GENERATORS.join(', ')}`);
        }
        const cfg = await config(root);
        const list = (k: string) => splitList(values[k] as string[] | undefined);
        generate(kind as GeneratorKind, name, {
          module: values.module as string | undefined,
          root: cfg.root,
          entry: cfg.entry,
          fields: values.fields as string | undefined,
          spec: {
            commands: list('commands'),
            callbacks: list('callbacks'),
            hears: list('hears'),
            // entity specs contain commas, so several entities are separated by ';' or repeated flags
            entities: splitList(values.entity as string[] | undefined, /;/),
            services: list('services'),
            endpoints: list('endpoints'),
            scenes: list('scenes'),
            imports: list('imports'),
          },
        });
        return;
      }
      case 'add':
        return await addPackages(await config(root), rest, !!values.dev);
      case 'deps':
        if (!(await checkAllDeps(await config(root)))) process.exitCode = 1;
        return;
      case 'commands': {
        const cfg = await config(root);
        const r = await buildProject(cfg, { quiet: true });
        if (!r.manifest.commands.length) log.info('No commands with a description. Add `{ description }` to command().');
        for (const c of r.manifest.commands) log.info(`  /${c.command} — ${c.description}`);
        log.info(color.dim('\nRegister them with Telegram by calling `await app.syncCommands()` (e.g. from an admin command).'));
        return;
      }
      case 'doctor':
        if (!(await doctor(await config(root)))) process.exitCode = 1;
        return;
      default:
        throw new CliError(`Unknown command "${cmd}". Run \`tgless --help\`.`);
    }
  } catch (e) {
    if (e instanceof CliError) {
      log.error(e.message);
      process.exitCode = 1;
      return;
    }
    throw e;
  }
}
