/**
 * Lightweight logger utility with emoji-prefixed action categories and timing.
 *
 * Usage:
 *   logger.api('upload', 'Fetching FS profile for KWCJ-QVS...')
 *   // → 🌐 [upload] Fetching FS profile for KWCJ-QVS...
 *
 *   logger.time('upload', 'photo-upload')
 *   // ... work ...
 *   logger.timeEnd('upload', 'photo-upload')
 *   // → ⏱️ [upload] photo-upload: 3.2s
 */

const ICONS = {
  api: '🌐',
  browser: '🎭',
  db: '💾',
  photo: '📸',
  upload: '⬆️',
  download: '⬇️',
  sync: '🔄',
  compare: '🔍',
  auth: '🔑',
  cache: '📦',
  ok: '✅',
  warn: '⚠️',
  error: '❌',
  start: '▶️',
  done: '✔️',
  skip: '⏭️',
  data: '📋',
  nav: '🧭',
  time: '⏱️',
} as const;

type Icon = keyof typeof ICONS;

const timers = new Map<string, number>();

function log(icon: string, ctx: string, msg: string): void {
  console.log(`${icon} [${ctx}] ${msg}`);
}

function logWarn(icon: string, ctx: string, msg: string): void {
  console.warn(`${icon} [${ctx}] ${msg}`);
}

function logError(icon: string, ctx: string, msg: string): void {
  console.error(`${icon} [${ctx}] ${msg}`);
}

function makeLogger(icon: Icon) {
  const emoji = ICONS[icon];
  if (icon === 'error') return (ctx: string, msg: string) => logError(emoji, ctx, msg);
  if (icon === 'warn') return (ctx: string, msg: string) => logWarn(emoji, ctx, msg);
  return (ctx: string, msg: string) => log(emoji, ctx, msg);
}

export const logger = {
  api: makeLogger('api'),
  browser: makeLogger('browser'),
  db: makeLogger('db'),
  photo: makeLogger('photo'),
  upload: makeLogger('upload'),
  download: makeLogger('download'),
  sync: makeLogger('sync'),
  compare: makeLogger('compare'),
  auth: makeLogger('auth'),
  cache: makeLogger('cache'),
  ok: makeLogger('ok'),
  warn: makeLogger('warn'),
  error: makeLogger('error'),
  start: makeLogger('start'),
  done: makeLogger('done'),
  skip: makeLogger('skip'),
  data: makeLogger('data'),
  nav: makeLogger('nav'),

  time(ctx: string, label: string): void {
    timers.set(`${ctx}:${label}`, performance.now());
  },

  timeEnd(ctx: string, label: string): void {
    const key = `${ctx}:${label}`;
    const start = timers.get(key);
    if (start === undefined) {
      log(ICONS.time, ctx, `${label}: no timer found`);
      return;
    }
    timers.delete(key);
    const elapsed = performance.now() - start;
    const formatted = elapsed >= 1000
      ? `${(elapsed / 1000).toFixed(1)}s`
      : `${Math.round(elapsed)}ms`;
    log(ICONS.time, ctx, `${label}: ${formatted}`);
  },
};
