import type {
  ApiMethods,
  CallbackQuery,
  Chat,
  InlineQuery,
  InlineQueryResult,
  Message,
  ParseMode,
  Update,
  User,
} from '@grammyjs/types';
import type { BotApi, InputFileLike, Platform, SdkDatabase, SdkFetch, SdkModule } from '../sdk.js';
import type { Container, Token } from './di.js';
import { type KeyboardLike, toReplyMarkup } from './keyboard.js';
import type { UpdateType } from './update-types.js';
import type { SceneControl } from './scene.js';
import type { App } from './app.js';

/**
 * Session shape. Extend it with declaration merging:
 *
 * ```ts
 * declare module 'tglessjs' {
 *   interface SessionData { lang: string; cart: number[] }
 * }
 * ```
 */
export interface SessionData {}

type Api = ApiMethods<InputFileLike>;
type P<M extends keyof Api> = Parameters<Api[M]>[0];

/** Options for `ctx.reply()` & friends: any Bot API param, plus `keyboard`. */
export type SendOptions<M extends keyof Api> = Omit<P<M>, 'chat_id' | 'reply_markup'> & {
  keyboard?: KeyboardLike;
  reply_markup?: P<M> extends { reply_markup?: infer R } ? R : never;
  /** Reply to the current message (quote it). */
  quote?: boolean;
};
type SendOpts<M extends keyof Api, K extends string> = Partial<Omit<SendOptions<M>, K>>;

export interface ContextHost {
  platform: Platform;
  defaults: { parseMode?: ParseMode; linkPreview?: boolean };
  rootContainer: Container;
}

/**
 * The per-update context handed to every handler and middleware.
 * Shortcuts cover the common cases; `ctx.api` is the full Bot API.
 */
export class Context {
  /** Free-form per-request bag for middlewares. */
  readonly state: Record<string, any> = {};
  /** Params from a callback pattern (`cart:add/:id`). */
  params: Record<string, string> = {};
  /** RegExp match from `hears()` / callbacks / inline queries. */
  match: RegExpMatchArray | null = null;
  /** The module container of the route currently running (for `inject`). */
  container: Container;
  /** Set by the session middleware when sessions are enabled. */
  session!: SessionData & Record<string, any>;
  /** Set when scenes are registered. */
  scene!: SceneControl;
  /** True once the callback query has been answered (auto-answered otherwise). */
  callbackAnswered = false;

  constructor(
    readonly host: ContextHost,
    /** The update type, e.g. `message`, `callback_query`. */
    readonly updateType: UpdateType,
    /** The update payload, e.g. the `Message` for `message`. */
    readonly payload: any,
    /** The full update. */
    readonly update: Update,
  ) {
    this.container = host.rootContainer;
  }

  // ── platform ──

  /** The app instance (e.g. `ctx.app.syncCommands()`). */
  get app(): App {
    return this.host as unknown as App;
  }

  /** Full Bot API: `await ctx.api.sendMessage({...})`. */
  get api(): BotApi {
    return this.host.platform.sdk.api;
  }
  /** Raw tgcloud database (prefer entities). */
  get db(): SdkDatabase {
    return this.host.platform.sdk.db;
  }
  /** Outbound HTTP (tgcloud's fetch). */
  get fetch(): SdkFetch {
    return this.host.platform.sdk.fetch;
  }
  /** The raw `sdk` module (`InputFile`, `BotApiError`, …). */
  get sdk(): SdkModule {
    return this.host.platform.sdk;
  }

  /** Resolve a provider from the current module. */
  inject<T>(token: Token<T>): T {
    return this.container.resolve(token) as T;
  }

  // ── update accessors ──

  get message(): Message | undefined {
    return this.update.message;
  }
  get editedMessage(): Message | undefined {
    return this.update.edited_message;
  }
  get channelPost(): Message | undefined {
    return this.update.channel_post;
  }
  get callbackQuery(): CallbackQuery | undefined {
    return this.update.callback_query;
  }
  get inlineQuery(): InlineQuery | undefined {
    return this.update.inline_query;
  }
  /** The relevant message: the new/edited message, channel post, or the callback's message. */
  get msg(): Message | undefined {
    const u = this.update;
    return (
      u.message ??
      u.edited_message ??
      u.channel_post ??
      u.edited_channel_post ??
      u.business_message ??
      u.edited_business_message ??
      (u.callback_query?.message as Message | undefined)
    );
  }
  /** The user who caused the update. */
  get from(): User | undefined {
    const p = this.payload;
    return p?.from ?? p?.user ?? this.msg?.from;
  }
  get chat(): Chat | undefined {
    return this.payload?.chat ?? this.msg?.chat ?? this.payload?.message?.chat;
  }
  get chatId(): number | undefined {
    return this.chat?.id;
  }
  /** Message text or caption. */
  get text(): string | undefined {
    const m = this.msg;
    if (this.updateType === 'callback_query') return undefined;
    return m?.text ?? m?.caption;
  }
  /** callback_data of a callback query. */
  get data(): string | undefined {
    return this.update.callback_query?.data;
  }
  /** Inline query text. */
  get query(): string | undefined {
    return this.update.inline_query?.query;
  }

  // ── sending ──

  private requireChat(action: string): number {
    const id = this.chatId;
    if (id === undefined) throw new Error(`ctx.${action}() needs a chat, but this ${this.updateType} update has none.`);
    return id;
  }

  private sendParams(opts: object | undefined, text = false): Record<string, unknown> {
    const { keyboard, quote, ...rest } = (opts ?? {}) as Record<string, any>;
    const out: Record<string, unknown> = { ...rest };
    const markup = toReplyMarkup(keyboard);
    if (markup) out.reply_markup = markup;
    const thread = this.msg?.is_topic_message ? this.msg.message_thread_id : undefined;
    if (thread !== undefined && out.message_thread_id === undefined) out.message_thread_id = thread;
    if (quote && this.msg) out.reply_parameters = { message_id: this.msg.message_id };
    const d = this.host.defaults;
    if (text) {
      if (d.parseMode && out.parse_mode === undefined) out.parse_mode = d.parseMode;
      if (d.linkPreview === false && out.link_preview_options === undefined) out.link_preview_options = { is_disabled: true };
    } else if (d.parseMode && out.parse_mode === undefined && 'caption' in out) {
      out.parse_mode = d.parseMode;
    }
    return out;
  }

  /** Send a text message to the current chat. */
  reply(text: string, opts?: SendOpts<'sendMessage', 'text'>): Promise<Message.TextMessage> {
    return this.api.sendMessage({ chat_id: this.requireChat('reply'), text, ...this.sendParams(opts, true) } as any);
  }
  replyWithPhoto(photo: string | InputFileLike, opts?: SendOpts<'sendPhoto', 'photo'>): Promise<Message.PhotoMessage> {
    return this.api.sendPhoto({ chat_id: this.requireChat('replyWithPhoto'), photo, ...this.sendParams(opts) } as any);
  }
  replyWithDocument(document: string | InputFileLike, opts?: SendOpts<'sendDocument', 'document'>): Promise<Message.DocumentMessage> {
    return this.api.sendDocument({ chat_id: this.requireChat('replyWithDocument'), document, ...this.sendParams(opts) } as any);
  }
  replyWithVideo(video: string | InputFileLike, opts?: SendOpts<'sendVideo', 'video'>): Promise<Message.VideoMessage> {
    return this.api.sendVideo({ chat_id: this.requireChat('replyWithVideo'), video, ...this.sendParams(opts) } as any);
  }
  replyWithAudio(audio: string | InputFileLike, opts?: SendOpts<'sendAudio', 'audio'>): Promise<Message.AudioMessage> {
    return this.api.sendAudio({ chat_id: this.requireChat('replyWithAudio'), audio, ...this.sendParams(opts) } as any);
  }
  replyWithVoice(voice: string | InputFileLike, opts?: SendOpts<'sendVoice', 'voice'>): Promise<Message.VoiceMessage> {
    return this.api.sendVoice({ chat_id: this.requireChat('replyWithVoice'), voice, ...this.sendParams(opts) } as any);
  }
  replyWithAnimation(animation: string | InputFileLike, opts?: SendOpts<'sendAnimation', 'animation'>): Promise<Message.AnimationMessage> {
    return this.api.sendAnimation({ chat_id: this.requireChat('replyWithAnimation'), animation, ...this.sendParams(opts) } as any);
  }
  replyWithSticker(sticker: string | InputFileLike, opts?: SendOpts<'sendSticker', 'sticker'>): Promise<Message.StickerMessage> {
    return this.api.sendSticker({ chat_id: this.requireChat('replyWithSticker'), sticker, ...this.sendParams(opts) } as any);
  }
  replyWithLocation(latitude: number, longitude: number, opts?: SendOpts<'sendLocation', 'latitude' | 'longitude'>): Promise<Message.LocationMessage> {
    return this.api.sendLocation({ chat_id: this.requireChat('replyWithLocation'), latitude, longitude, ...this.sendParams(opts) } as any);
  }
  /** Show "typing…" (or another chat action). */
  typing(action: P<'sendChatAction'>['action'] = 'typing'): Promise<true> {
    return this.api.sendChatAction({ chat_id: this.requireChat('typing'), action } as any);
  }

  // ── editing ──

  private target(): { chat_id: number; message_id: number } | { inline_message_id: string } {
    const cq = this.update.callback_query;
    if (cq?.inline_message_id) return { inline_message_id: cq.inline_message_id };
    const m = this.msg;
    if (!m) throw new Error(`Nothing to edit in a ${this.updateType} update.`);
    return { chat_id: m.chat.id, message_id: m.message_id };
  }

  /** Edit the text of the current message (the callback's message, typically). */
  edit(text: string, opts?: SendOpts<'editMessageText', 'text'>): Promise<Message | true> {
    return this.api.editMessageText({ ...this.target(), text, ...this.sendParams(opts, true) } as any);
  }
  /** Replace (or remove, with `undefined`) the inline keyboard of the current message. */
  editKeyboard(keyboard?: KeyboardLike): Promise<Message | true> {
    return this.api.editMessageReplyMarkup({ ...this.target(), reply_markup: toReplyMarkup(keyboard) } as any);
  }
  editCaption(caption: string, opts?: SendOpts<'editMessageCaption', 'caption'>): Promise<Message | true> {
    return this.api.editMessageCaption({ ...this.target(), caption, ...this.sendParams(opts) } as any);
  }
  /** Delete the current message. Ignores "message already deleted". */
  async deleteMessage(): Promise<boolean> {
    const m = this.msg;
    if (!m) return false;
    try {
      return await this.api.deleteMessage({ chat_id: m.chat.id, message_id: m.message_id });
    } catch (e: any) {
      if (e?.code === 400) return false;
      throw e;
    }
  }

  // ── answering ──

  /** Answer the callback query (toast text optional). Called automatically if you don't. */
  async answer(text?: string, opts: Omit<P<'answerCallbackQuery'>, 'callback_query_id' | 'text'> = {}): Promise<true> {
    const cq = this.update.callback_query;
    if (!cq) throw new Error(`ctx.answer() is only for callback queries (got ${this.updateType}).`);
    this.callbackAnswered = true;
    return this.api.answerCallbackQuery({ callback_query_id: cq.id, ...(text ? { text } : {}), ...opts });
  }
  /** Answer with an alert popup instead of a toast. */
  alert(text: string): Promise<true> {
    return this.answer(text, { show_alert: true });
  }
  /** Answer an inline query. */
  answerInline(results: readonly InlineQueryResult[], opts: Omit<P<'answerInlineQuery'>, 'inline_query_id' | 'results'> = {}): Promise<true> {
    const q = this.update.inline_query;
    if (!q) throw new Error(`ctx.answerInline() is only for inline queries (got ${this.updateType}).`);
    return this.api.answerInlineQuery({ inline_query_id: q.id, results, ...opts });
  }
}
