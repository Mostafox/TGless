import type { Chat, Message, Update, User } from '@grammyjs/types';
import type { App } from '../runtime/app.js';
import type { InitData } from '../runtime/endpoint.js';
import type { Provider, Token } from '../runtime/di.js';
import type { UpdateType } from '../runtime/update-types.js';
import { type MockPlatform, createMockPlatform, MockEndpointError } from './mock-sdk.js';

export { createMockPlatform, MockApi, MockFetch, MockBotApiError, MockEndpointError, type ApiCall, type MockPlatform } from './mock-sdk.js';
export { entityDdl } from './ddl.js';

export interface TestBotOptions {
  /** Default sender. */
  user?: Partial<User>;
  /** Default chat (private chat with the user by default). */
  chat?: Partial<Chat>;
}

export type EndpointResult<T = any> =
  | { ok: true; result: T }
  | { ok: false; error_type: 'ENDPOINT_ERROR' | 'INTERNAL'; description: string; parameters?: Record<string, unknown> };

/**
 * An app wired to an in-memory platform. Send it updates and assert on Bot API calls.
 *
 * ```ts
 * const bot = createTestBot(app)
 * await bot.send('/start')
 * expect(bot.lastReply?.text).toContain('Welcome')
 * ```
 */
export class TestBot {
  readonly platform: MockPlatform;
  readonly user: User;
  readonly chat: Chat;
  private updateId = 1;
  private messageId = 1;

  constructor(
    readonly app: App,
    opts: TestBotOptions = {},
  ) {
    this.platform = createMockPlatform(app.entities());
    app.bind(this.platform);
    this.user = { id: 42, is_bot: false, first_name: 'Test', username: 'tester', language_code: 'en', ...opts.user } as User;
    this.chat = { id: this.user.id, type: 'private', first_name: this.user.first_name, ...opts.chat } as Chat;
  }

  /** Recorded Bot API calls and stubs. */
  get api() {
    return this.platform.api;
  }
  /** Outbound HTTP mock. */
  get fetch() {
    return this.platform.fetch;
  }
  /** Raw better-sqlite3 handle. */
  get sqlite() {
    return this.platform.sqlite;
  }

  /** Every message the bot sent (sendMessage/sendPhoto/…) as `{ method, ...params }`. */
  get replies(): Array<Record<string, any> & { method: string }> {
    return this.api.calls
      .filter((c) => c.method.startsWith('send') && c.method !== 'sendChatAction')
      .map((c) => ({ method: c.method, ...c.params }));
  }
  get lastReply() {
    const r = this.replies;
    return r[r.length - 1];
  }

  override<T>(token: Token<T>, provider: Provider<T>) {
    this.app.override(token, provider);
    return this;
  }

  /** Dispatch a raw update. */
  async update(update: Partial<Update> & Record<string, unknown>) {
    const full = { update_id: this.updateId++, ...update } as Update;
    const type = Object.keys(full).find((k) => k !== 'update_id') as UpdateType;
    await this.app.handle(type, (full as any)[type], { update: full });
  }

  private makeMessage(text: string | undefined, extra: Partial<Message> = {}, from?: Partial<User>): Message {
    const msg: any = {
      message_id: this.messageId++,
      date: Math.floor(Date.now() / 1000),
      chat: this.chat,
      from: { ...this.user, ...from },
      ...extra,
    };
    if (text !== undefined) {
      msg.text = text;
      const cmd = /^\/[A-Za-z0-9_]+(@[A-Za-z0-9_]+)?/.exec(text);
      if (cmd) msg.entities = [{ type: 'bot_command', offset: 0, length: cmd[0].length }];
    }
    return msg;
  }

  /** User sends a text message (commands get a `bot_command` entity). */
  async send(text: string, extra: Partial<Message> = {}, from?: Partial<User>) {
    const message = this.makeMessage(text, extra, from);
    await this.update({ message: message as any });
    return message;
  }

  /** User sends any message content: `bot.sendMessage({ photo: [...] })`. */
  async sendMessage(extra: Partial<Message>, from?: Partial<User>) {
    const message = this.makeMessage(undefined, extra, from);
    await this.update({ message: message as any });
    return message;
  }

  /** User taps an inline button with this callback_data. */
  async click(data: string, opts: { message?: Partial<Message>; from?: Partial<User> } = {}) {
    const message = { ...this.makeMessage('…'), from: { id: 1, is_bot: true, first_name: 'TestBot' }, ...opts.message };
    await this.update({
      callback_query: {
        id: String(this.updateId),
        from: { ...this.user, ...opts.from },
        chat_instance: '1',
        data,
        message,
      } as any,
    });
  }

  /** User types an inline query. */
  async inline(query: string, from?: Partial<User>) {
    await this.update({
      inline_query: { id: String(this.updateId), from: { ...this.user, ...from }, query, offset: '' } as any,
    });
  }

  /**
   * Call a Mini App endpoint like the platform does. Returns the response
   * envelope (`{ ok, result }` / `{ ok: false, error_type, description }`).
   */
  async call<T = any>(name: string, input: Record<string, unknown> = {}, initData: Partial<InitData> = {}): Promise<EndpointResult<T>> {
    const ctx = { initData: { user: { ...this.user }, auth_date: Math.floor(Date.now() / 1000), ...initData } };
    try {
      return { ok: true, result: (await this.app.callEndpoint(name, input, ctx)) as T };
    } catch (e) {
      if (e instanceof MockEndpointError) {
        return { ok: false, error_type: 'ENDPOINT_ERROR', description: e.description, parameters: e.parameters };
      }
      return { ok: false, error_type: 'INTERNAL', description: (e as Error)?.message ?? String(e) };
    }
  }

  /** Forget recorded API calls. */
  reset() {
    this.api.reset();
  }
}

/** Create a test bot for an app (fresh in-memory database each time). */
export function createTestBot(app: App, opts?: TestBotOptions): TestBot {
  return new TestBot(app, opts);
}
