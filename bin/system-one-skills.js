#!/usr/bin/env node
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from '../src/check.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const NAME = 'system-one-skills';
const COMMANDS = ['check', 'install-skills', 'help', 'version'];

const bare = `Keep noisy test and build logs out of your agent's context.

Start here
  ${NAME} install-skills --target <dir>  Add the skill to an agent
  ${NAME} check -- <command>             Run a noisy test or build

All commands: ${NAME} --help
`;

const rootHelp = `Usage: ${NAME} <command> [options]

Keep noisy test and build logs out of your agent's context.

Start here
  install-skills --target <dir>   Copy the system-one-verify skill into an
                                  agent's skills folder
  check -- <command> [args...]    Run a test or build and print only the
                                  verdict, the errors and the last lines

Options
  -h, --help       Show help (also: ${NAME} help <command>)
  -V, --version    Show the version

Example
  ${NAME} install-skills --target .agents/skills
  ${NAME} check -- npm test
`;

const commandHelp = {
  check: `Usage: ${NAME} check [options] -- <command> [args...]

Run a test or build once. Short output passes through unchanged. Long output
is cut down to the exit code, the errors and the last lines, and the full
output is kept in a private log file.

Options
  --log <path>       Save the full log here (the file must not exist yet)
  --cwd <dir>        Run the command in this folder
  --timeout-ms <n>   Stop the command after n milliseconds (default 300000,
                     at most 900000)

Exits with the command's own exit code. Errors from ${NAME} itself
exit 2.

Example
  ${NAME} check -- npm test
`,
  'install-skills': `Usage: ${NAME} install-skills --target <dir>

Copy the system-one-verify skill into an agent's skills folder. An identical
copy that is already there is left alone, and a changed copy is never
overwritten.

Options
  --target <dir>   The agent's skills folder, such as .agents/skills or
                   .claude/skills

Example
  ${NAME} install-skills --target .agents/skills
`,
};

// TODO(df-0.8): use detectAudience and the cli-style symbols from
// @hraness/desktop-foundation. This copies the SPEC § C and § D6 rules inline.
function audience(env = process.env, stderr = process.stderr) {
  const forced = (env.HRANESS_AUDIENCE ?? '').toLowerCase();
  if (forced === 'human' || forced === 'agent' || forced === 'quiet') return forced;
  if (forced === 'off') return 'quiet';
  for (const marker of ['AI_AGENT', 'CLAUDECODE', 'CODEX_SANDBOX', 'CODEX_SANDBOX_NETWORK_DISABLED', 'CURSOR_AGENT', 'GEMINI_CLI']) {
    if (env[marker]) return 'agent';
  }
  return stderr.isTTY ? 'human' : 'quiet';
}

function ascii(env = process.env) {
  if (env.HRANESS_ASCII === '1' || env.TERM === 'dumb') return true;
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || '';
  return !/utf-?8/i.test(locale);
}

/** @param {'fail'|'ok'|'next'} kind @param {NodeJS.WriteStream} stream */
function symbol(kind, stream, env = process.env) {
  const glyph = ascii(env) ? { fail: 'FAIL', ok: 'OK', next: '->' }[kind] : { fail: '✗', ok: '✓', next: '→' }[kind];
  const color = env.FORCE_COLOR === '1' || (stream.isTTY && env.TERM !== 'dumb' && !env.NO_COLOR);
  if (!color) return glyph;
  const code = { fail: '31', ok: '32', next: '2' }[kind];
  return `\x1b[${code}m${glyph}\x1b[0m`;
}

/** An error whose fixed message is safe to print: it never contains arguments, paths or log text. */
class CliError extends Error {
  /** @param {string} message @param {string} next */
  constructor(message, next) {
    super(message);
    this.next = next;
  }
}

/** @param {string} a @param {string} b @returns {number} */
function distance(a, b) {
  /** @type {number[]} */
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    /** @type {number[]} */
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(Number(row[j]) + 1, Number(next[j - 1]) + 1, Number(row[j - 1]) + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return Number(row[b.length]);
}

/** Suggest a known name without echoing what was typed. @param {string} input @param {string[]} known */
function suggestion(input, known) {
  const best = known.map(name => ({ name, d: distance(input, name) })).sort((a, b) => a.d - b.d)[0];
  return best && best.d <= Math.max(2, Math.floor(best.name.length / 3)) ? ` Did you mean "${best.name}"?` : '';
}

/** @param {string[]} args @param {string[]} allowed @param {string} command */
function flags(args, allowed, command) {
  /** @type {Record<string,string>} */
  const out = {};
  const next = `${NAME} ${command} --help`;
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (!key || !allowed.includes(key)) throw new CliError(`Unknown option for ${command}.${suggestion(key ?? '', allowed)}`, next);
    if (Object.hasOwn(out, key)) throw new CliError(`The ${key} option was given twice.`, next);
    if (!value || value.startsWith('--')) throw new CliError(`The ${key} option needs a value.`, next);
    out[key] = value;
  }
  return out;
}

/** @param {string} source @param {string} dest @returns {boolean} */
function identical(source, dest) {
  const a = lstatSync(source);
  const b = lstatSync(dest);
  if (a.isSymbolicLink() || b.isSymbolicLink()) return false;
  if (a.isFile() && b.isFile()) return readFileSync(source).equals(readFileSync(dest));
  if (!a.isDirectory() || !b.isDirectory()) return false;
  const names = readdirSync(source).sort();
  const others = readdirSync(dest).sort();
  return names.length === others.length && names.every((name, i) => name === others[i] && identical(join(source, name), join(dest, name)));
}

function version() {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
}

/** @param {string} text */
function hint(text) {
  if (audience() === 'human') process.stderr.write(`Next: ${text}\n`);
}

/** @param {unknown} error */
function code(error) {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
}

/** @param {string[]} args */
function installSkills(args) {
  const options = flags(args, ['--target'], 'install-skills');
  if (!options['--target']) throw new CliError('install-skills needs a --target folder.', `${NAME} install-skills --help`);
  const target = resolve(options['--target']);
  const skills = join(root, 'skills');
  const names = readdirSync(skills).filter(name => lstatSync(join(skills, name)).isDirectory());
  try {
    for (const name of names) {
      const dest = join(target, name);
      let present = false;
      try { lstatSync(dest); present = true; } catch (error) { if (code(error) !== 'ENOENT') throw error; }
      if (present && !identical(join(skills, name), dest)) {
        throw new CliError(`A changed copy of ${name} is already in that folder, so nothing was installed. Keep your copy, or pick an empty folder.`, `${NAME} install-skills --target <empty-dir>`);
      }
    }
    mkdirSync(target, { recursive: true });
    let copied = 0;
    for (const name of names) {
      if (existsSync(join(target, name))) continue;
      cpSync(join(skills, name), join(target, name), { recursive: true, errorOnExist: true, force: false });
      copied++;
    }
    const label = names.join(', ');
    process.stdout.write(copied
      ? `${symbol('ok', process.stdout)} Installed ${label}.\n`
      : `${symbol('ok', process.stdout)} ${label} is already installed and up to date.\n`);
    hint(`${NAME} check -- npm test`);
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError("Couldn't write to the skills folder: it isn't writable or isn't a folder.", `${NAME} install-skills --help`);
  }
}

/** @param {string[]} args */
async function runCheck(args) {
  const separator = args.indexOf('--');
  if (separator < 0 || separator === args.length - 1) throw new CliError('check needs a command after --.', `${NAME} check -- npm test`);
  const options = flags(args.slice(0, separator), ['--cwd', '--timeout-ms', '--log'], 'check');
  const timeoutMs = options['--timeout-ms'] === undefined ? 300000 : Number(options['--timeout-ms']);
  if ((options['--timeout-ms'] !== undefined && !/^\d+$/.test(options['--timeout-ms'])) || timeoutMs < 1 || timeoutMs > 900000) {
    throw new CliError('--timeout-ms must be a whole number from 1 to 900000.', `${NAME} check --help`);
  }
  const controller = new AbortController();
  const interrupt = () => controller.abort('SIGINT');
  const terminate = () => controller.abort('SIGTERM');
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  try {
    const result = await check({ argv: args.slice(separator + 1), cwd: options['--cwd'], timeoutMs, logPath: options['--log'], signal: controller.signal });
    process.stdout.write(result.stdout);
    process.exitCode = result.code;
  } catch (error) {
    if (code(error) === 'EEXIST') throw new CliError('The log file already exists, so the command did not run.', `${NAME} check --log <new-path> -- <command>`);
    if (code(error) === 'ENOENT' || code(error) === 'EACCES' || code(error) === 'EPERM' || code(error) === 'ENOTDIR') {
      throw new CliError("Couldn't create the log file: its folder is missing or not writable.", `${NAME} check --help`);
    }
    throw error;
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command) {
    process.stdout.write(`${bare}${NAME} ${version()}\n`);
    return;
  }
  if (command === '--help' || command === '-h' || command === 'help') {
    const topic = args[0];
    if (args.length > 1 || (topic && !Object.hasOwn(commandHelp, topic))) {
      throw new CliError(`There is no help for that command.${topic ? suggestion(topic, Object.keys(commandHelp)) : ''}`, `${NAME} --help`);
    }
    process.stdout.write(topic ? commandHelp[/** @type {keyof typeof commandHelp} */ (topic)] : rootHelp);
    return;
  }
  if (command === '--version' || command === '-V' || command === '-v' || command === 'version') {
    if (args.length) throw new CliError('--version takes no arguments.', `${NAME} --version`);
    process.stdout.write(`${NAME} ${version()}\n`);
    return;
  }
  if (Object.hasOwn(commandHelp, command) && (args[0] === '--help' || args[0] === '-h')) {
    process.stdout.write(commandHelp[/** @type {keyof typeof commandHelp} */ (command)]);
    return;
  }
  if (command === 'install-skills') return installSkills(args);
  if (command === 'check') return runCheck(args);
  throw new CliError(`Unknown command.${suggestion(command, COMMANDS)}`, `${NAME} --help`);
}

// A closed pipe (for example `| head -1`) is a normal way to stop reading.
process.stdout.on('error', error => {
  if (code(error) === 'EPIPE') process.exit(0);
  throw error;
});

try { await main(); }
catch (error) {
  // Only fixed messages are printed. Shell arguments, environment values,
  // paths and log contents are never echoed.
  const known = error instanceof CliError;
  const message = known ? error.message : "Couldn't complete the command.";
  const next = known ? error.next : `${NAME} --help`;
  process.stderr.write(`${symbol('fail', process.stderr)} ${message}\n${symbol('next', process.stderr)} ${next}\n`);
  process.exitCode = 2;
}
