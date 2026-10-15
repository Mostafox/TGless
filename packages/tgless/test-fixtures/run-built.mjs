// Runs a BUILT tgcloud/ folder in Node the way the platform would: the generated
// handlers/endpoints are imported as-is, `sdk`/`sdk/db` resolve to the mock platform,
// and `tgcloud/schema.js` is evaluated for real (drizzle stands in for sdk/db).
//
// usage: node run-built.mjs <projectRoot> <scenario.json>
// Prints a JSON report of Bot API calls and endpoint results.
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createMockPlatform, entityDdl } from 'tgless/testing';

const [root, scenarioFile] = process.argv.slice(2);
const scenario = JSON.parse(fs.readFileSync(scenarioFile, 'utf8'));

const platform = createMockPlatform([]);
globalThis.__tglessPlatform = platform;

const DB_EXPORTS = Object.keys(platform.dbModule).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k) && k !== 'default');
const sources = {
  sdk: `const p = globalThis.__tglessPlatform.sdk;
export const db = p.db, api = p.api, fetch = p.fetch, InputFile = p.InputFile, BotApiError = p.BotApiError, EndpointError = p.EndpointError;`,
  'sdk/db': `const m = globalThis.__tglessPlatform.dbModule;
export default m;
${DB_EXPORTS.map((k) => `export const ${k} = m.${k};`).join('\n')}`,
};
const hooks = `
const sources = ${JSON.stringify(sources)};
export async function resolve(specifier, context, next) {
  if (specifier in sources) return { url: 'tgless-sdk:' + specifier, shortCircuit: true };
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (url.startsWith('tgless-sdk:')) return { format: 'module', source: sources[url.slice(11)], shortCircuit: true };
  return next(url, context);
}`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`, import.meta.url);

const out = path.join(root, 'tgcloud');
const mod = (rel) => import(pathToFileURL(path.join(out, rel)).href);

// Tables are created from the bundled app's entities (what `tgcloud migrate` would do).
const { app } = await mod('lib/app.js');
const schema = await mod('schema.js');
for (const e of app.entities()) {
  if (!schema[e.exportName]) throw new Error(`schema.js is missing export ${e.exportName}`);
  for (const stmt of entityDdl(e)) platform.sqlite.exec(stmt);
}

const user = { id: 1, is_bot: false, first_name: 'Admin', username: 'admin' };
const chat = { id: 1, type: 'private', first_name: 'Admin' };
let id = 1;
const results = [];
for (const step of scenario) {
  if (step.text !== undefined) {
    const message = { message_id: id, date: 0, chat, from: user, text: step.text };
    if (step.text.startsWith('/')) message.entities = [{ type: 'bot_command', offset: 0, length: step.text.split(' ')[0].length }];
    const handler = (await mod('handlers/message.js')).default;
    await handler(message, { update: { update_id: id++, message } });
  } else if (step.click !== undefined) {
    const cq = { id: String(id), from: user, chat_instance: '1', data: step.click, message: { message_id: 1, date: 0, chat, text: '…' } };
    const handler = (await mod('handlers/callback_query.js')).default;
    await handler(cq, { update: { update_id: id++, callback_query: cq } });
  } else if (step.endpoint) {
    const fn = (await mod(`endpoints/${step.endpoint}.js`)).default;
    try {
      results.push({ endpoint: step.endpoint, ok: true, result: await fn(step.input ?? {}, { initData: { user, auth_date: 0 } }) });
    } catch (e) {
      results.push({ endpoint: step.endpoint, ok: false, error: e.name, description: e.description ?? e.message });
    }
  }
}
console.log(JSON.stringify({ calls: platform.api.calls, results }));
