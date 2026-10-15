/** Escapes text for `parse_mode: 'HTML'`. */
export function escapeHtml(s: unknown): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escapes text for `parse_mode: 'MarkdownV2'`. */
export function escapeMd(s: unknown): string {
  return String(s).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

class Raw {
  constructor(readonly value: string) {}
  toString() {
    return this.value;
  }
}

type Tag = ((strings: TemplateStringsArray, ...values: unknown[]) => string) & {
  /** Insert without escaping. */
  raw(s: string): Raw;
  escape(s: unknown): string;
};

function makeTag(escape: (s: unknown) => string): Tag {
  const tag = ((strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((out, str, i) => {
      if (i === 0) return str;
      const v = values[i - 1];
      return out + (v instanceof Raw ? v.value : escape(v ?? '')) + str;
    }, '')) as Tag;
  tag.raw = (s) => new Raw(s);
  tag.escape = escape;
  return tag;
}

/** `html\`<b>${name}</b>\`` escapes the interpolated values. Use with `parseMode: 'HTML'`. */
export const html = makeTag(escapeHtml);
/** Same for MarkdownV2. */
export const md = makeTag(escapeMd);
