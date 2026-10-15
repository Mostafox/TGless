import type {
  InlineKeyboardButton,
  InlineKeyboardMarkup,
  KeyboardButton,
  ReplyKeyboardMarkup,
  ReplyKeyboardRemove,
  ForceReply,
} from '@grammyjs/types';

export type ReplyMarkup = InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply;

/** Anything that can become `reply_markup`. */
export type KeyboardLike = InlineKeyboard | ReplyKeyboard | ReplyMarkup;

/**
 * Inline keyboard builder.
 *
 * ```ts
 * inline()
 *   .text('➕ Add', addToCart.data({ id: 5 }))
 *   .url('Docs', 'https://example.com')
 *   .row()
 *   .webApp('Open shop', 'https://app123.tgcloud.ai/')
 * ```
 */
export class InlineKeyboard {
  readonly rows: InlineKeyboardButton[][] = [[]];

  private push(button: InlineKeyboardButton) {
    this.rows[this.rows.length - 1].push(button);
    return this;
  }

  /** Callback button. `data` is usually built with `myCallback.data({...})`. */
  text(label: string, data: string) {
    return this.push({ text: label, callback_data: data });
  }
  url(label: string, url: string) {
    return this.push({ text: label, url });
  }
  webApp(label: string, url: string) {
    return this.push({ text: label, web_app: { url } });
  }
  switchInline(label: string, query = '') {
    return this.push({ text: label, switch_inline_query: query });
  }
  switchInlineCurrent(label: string, query = '') {
    return this.push({ text: label, switch_inline_query_current_chat: query });
  }
  copy(label: string, text: string) {
    return this.push({ text: label, copy_text: { text } });
  }
  pay(label: string) {
    return this.push({ text: label, pay: true });
  }
  /** Add any raw button. */
  button(button: InlineKeyboardButton) {
    return this.push(button);
  }
  row() {
    if (this.rows[this.rows.length - 1].length) this.rows.push([]);
    return this;
  }
  /** Lay out many buttons in rows of `columns`. */
  grid<T>(items: T[], columns: number, toButton: (item: T, i: number) => InlineKeyboardButton) {
    this.row();
    items.forEach((item, i) => {
      if (i > 0 && i % columns === 0) this.row();
      this.push(toButton(item, i));
    });
    return this.row();
  }
  build(): InlineKeyboardMarkup {
    return { inline_keyboard: this.rows.filter((r) => r.length) };
  }
}

/** Reply (custom) keyboard builder. */
export class ReplyKeyboard {
  readonly rows: KeyboardButton[][] = [[]];
  private opts: Omit<ReplyKeyboardMarkup, 'keyboard'> = { resize_keyboard: true };

  private push(button: KeyboardButton) {
    this.rows[this.rows.length - 1].push(button);
    return this;
  }
  text(label: string) {
    return this.push({ text: label });
  }
  requestContact(label: string) {
    return this.push({ text: label, request_contact: true });
  }
  requestLocation(label: string) {
    return this.push({ text: label, request_location: true });
  }
  webApp(label: string, url: string) {
    return this.push({ text: label, web_app: { url } });
  }
  row() {
    if (this.rows[this.rows.length - 1].length) this.rows.push([]);
    return this;
  }
  oneTime(v = true) {
    this.opts.one_time_keyboard = v;
    return this;
  }
  resize(v = true) {
    this.opts.resize_keyboard = v;
    return this;
  }
  persistent(v = true) {
    this.opts.is_persistent = v;
    return this;
  }
  placeholder(text: string) {
    this.opts.input_field_placeholder = text;
    return this;
  }
  build(): ReplyKeyboardMarkup {
    return { keyboard: this.rows.filter((r) => r.length), ...this.opts };
  }
}

export const inline = () => new InlineKeyboard();
export const keyboard = () => new ReplyKeyboard();
export const removeKeyboard = (): ReplyKeyboardRemove => ({ remove_keyboard: true });
export const forceReply = (placeholder?: string): ForceReply => ({
  force_reply: true,
  ...(placeholder ? { input_field_placeholder: placeholder } : {}),
});

export function toReplyMarkup(k: KeyboardLike | undefined): ReplyMarkup | undefined {
  if (!k) return undefined;
  if (k instanceof InlineKeyboard || k instanceof ReplyKeyboard) return k.build();
  return k;
}
