/**
 * Runs in a fresh Node process: loads the bundled app (with a stubbed sdk), reads
 * `app.manifest()` and generates schema.js. A new process per build keeps module
 * state (e.g. the entity registry) from leaking between rebuilds.
 *
 * usage: node manifest-runner.js <bundle.mjs>  → prints MARKER + JSON on stdout
 */
import { pathToFileURL } from 'node:url';
import { generateSchemaJs } from '../db/codegen.js';
import { MARKER, type ManifestPayload } from './manifest-protocol.js';

function emit(payload: ManifestPayload) {
  process.stdout.write(`\n${MARKER}${JSON.stringify(payload)}\n`);
}

async function run(file: string) {
  let app: any;
  try {
    app = (await import(pathToFileURL(file).href)).default;
  } catch (e) {
    return emit({ ok: false, error: 'LOAD', message: (e as Error)?.stack ?? String(e) });
  }
  if (!app || typeof app.manifest !== 'function' || typeof app.handle !== 'function') {
    return emit({ ok: false, error: 'NOT_APP' });
  }
  try {
    const m = app.manifest();
    const schema = generateSchemaJs(m.entities);
    emit({
      ok: true,
      updates: m.updates,
      endpoints: m.endpoints,
      commands: m.commands,
      tables: m.entities.map((e: any) => ({ tableName: e.tableName, exportName: e.exportName })),
      schema,
    });
  } catch (e) {
    emit({ ok: false, error: 'SCHEMA', message: (e as Error)?.message ?? String(e) });
  }
}

if (process.argv[2]) await run(process.argv[2]);
