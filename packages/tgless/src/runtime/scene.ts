import type { Context } from './context.js';
import type { Handler } from './routes.js';

/**
 * Multi-step conversations ("wizards") stored in the session.
 *
 * ```ts
 * export const signup = scene<{ name?: string }>('signup', [
 *   async (ctx) => { await ctx.reply('Your name?'); ctx.scene.next() },
 *   async (ctx) => {
 *     if (!ctx.text) return ctx.reply('Please send text')   // stay on this step
 *     ctx.scene.state.name = ctx.text
 *     await ctx.reply(`Hi ${ctx.text}!`)
 *     ctx.scene.leave()
 *   },
 * ])
 * // start it from anywhere:
 * await ctx.scene.enter('signup')
 * ```
 * Step 0 runs immediately on `enter()`; each following step runs on the next
 * update from the same chat/user. A step that doesn't call `next()`/`leave()`
 * runs again on the next update.
 */
export interface SceneControl<S = Record<string, any>> {
  /** Active scene id, if any. */
  readonly current: string | undefined;
  /** Current step index. */
  readonly step: number;
  /** Scene-local state (persisted in the session). */
  state: S;
  enter(id: string, state?: Partial<S>): Promise<void>;
  /** Move to the next step (it runs on the next update). Leaves after the last step. */
  next(): void;
  back(): void;
  goto(step: number): void;
  leave(): void;
}

export type SceneContext<S = Record<string, any>> = Context & { scene: SceneControl<S> };

export interface SceneOptions<S> {
  steps: Handler<SceneContext<S>>[];
  /** Commands that leave the scene (default `['cancel']`). */
  cancelCommands?: string[];
  /** Runs after a cancel command left the scene. */
  onCancel?: Handler<SceneContext<S>>;
}

export interface Scene<S = any> {
  kind: 'scene';
  id: string;
  options: SceneOptions<S>;
}

export function scene<S = Record<string, any>>(id: string, steps: Handler<SceneContext<S>>[] | SceneOptions<S>): Scene<S> {
  const options = Array.isArray(steps) ? { steps } : steps;
  if (!options.steps.length) throw new Error(`scene("${id}") needs at least one step.`);
  return { kind: 'scene', id, options };
}

interface StoredScene {
  id: string;
  step: number;
  state: Record<string, any>;
}

export const SCENE_KEY = '__scene';

/** Build `ctx.scene` for a context. `run` executes a scene step with module wiring. */
export function createSceneControl(
  ctx: Context,
  lookup: (id: string) => Scene | undefined,
  run: (scene: Scene, ctx: Context) => Promise<void>,
): SceneControl {
  const stored = (): StoredScene | undefined => (ctx.session as any)?.[SCENE_KEY];
  const set = (v: StoredScene | undefined) => {
    if (!ctx.session) throw new Error('Scenes need sessions. Enable them with createApp({ session: true }).');
    if (v) (ctx.session as any)[SCENE_KEY] = v;
    else delete (ctx.session as any)[SCENE_KEY];
  };
  return {
    get current() {
      return stored()?.id;
    },
    get step() {
      return stored()?.step ?? 0;
    },
    get state() {
      return stored()?.state ?? {};
    },
    set state(v) {
      const s = stored();
      if (s) s.state = v;
    },
    async enter(id, state = {}) {
      const sc = lookup(id);
      if (!sc) throw new Error(`Unknown scene "${id}". Register it in a module's \`scenes\`.`);
      set({ id, step: 0, state: { ...state } });
      await run(sc, ctx);
    },
    next() {
      const s = stored();
      if (!s) return;
      const sc = lookup(s.id);
      if (sc && s.step + 1 >= sc.options.steps.length) set(undefined);
      else s.step += 1;
    },
    back() {
      const s = stored();
      if (s) s.step = Math.max(0, s.step - 1);
    },
    goto(step) {
      const s = stored();
      if (s) s.step = step;
    },
    leave() {
      set(undefined);
    },
  };
}
