const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code: number, reset: number) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[${reset}m` : s);

export const color = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  cyan: wrap(36, 39),
};

export const log = {
  info: (msg: string) => console.log(msg),
  step: (msg: string) => console.log(`${color.cyan('›')} ${msg}`),
  ok: (msg: string) => console.log(`${color.green('✔')} ${msg}`),
  warn: (msg: string) => console.warn(`${color.yellow('⚠')} ${msg}`),
  error: (msg: string) => console.error(`${color.red('✖')} ${msg}`),
};

/** An error with a user-facing message (no stack trace printed). */
export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
