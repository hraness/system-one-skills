import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'bin/system-one-skills.js');
const node = Bun.which('node')!;
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version as string;
const scratch = mkdtempSync(join(tmpdir(), 'system-one-cli-ux-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const golden = (name: string) => readFileSync(join(root, 'tests/golden', name), 'utf8').replace('{version}', version);
function run(args: string[], env: Record<string, string | undefined> = {}) {
  const result = spawnSync(node, [cli, ...args], {
    cwd: scratch,
    timeout: 10000,
    env: { PATH: process.env.PATH ?? '', LANG: 'en_US.UTF-8', ...env },
  });
  return { status: result.status, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}
const width = (text: string) => Math.max(...text.split('\n').map(line => line.length));

describe('help and version', () => {
  test('bare invocation is a short start-here screen on stdout', () => {
    const result = run([]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(golden('bare.txt'));
    expect(result.stdout.split('\n').length).toBeLessThanOrEqual(25);
    expect(width(result.stdout)).toBeLessThanOrEqual(80);
    expect(result.stderr).toBe('');
  });
  test('--help, -h and help print the same root help', () => {
    for (const flag of ['--help', '-h', 'help']) {
      const result = run([flag]);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe(golden('help.txt'));
    }
    expect(width(golden('help.txt'))).toBeLessThanOrEqual(80);
  });
  test('every command has its own help that exits 0', () => {
    for (const command of ['check', 'install-skills']) {
      const expected = golden(`help-${command}.txt`);
      expect(width(expected)).toBeLessThanOrEqual(80);
      for (const args of [[command, '--help'], [command, '-h'], ['help', command]]) {
        const result = run(args);
        expect(result.status).toBe(0);
        expect(result.stdout).toBe(expected);
      }
    }
  });
  test('--version, -V and version print the bin name and version', () => {
    for (const flag of ['--version', '-V', '-v', 'version']) {
      const result = run([flag]);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe(`system-one-skills ${version}\n`);
    }
  });
  test('a closed pipe exits quietly', () => {
    const result = spawnSync('/bin/sh', ['-c', `"${node}" "${cli}" --help | head -1`], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', LANG: 'en_US.UTF-8' } });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('Usage: system-one-skills <command> [options]\n');
    expect(result.stderr).toBe('');
  });
});

describe('errors', () => {
  test('an unknown command suggests the closest one without echoing the input', () => {
    const result = run(['chek']);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('✗ Unknown command. Did you mean "check"?\n→ system-one-skills --help\n');
  });
  test('an unknown option names the closest known option', () => {
    const result = run(['check', '--lgo', 'x', '--', node, '-e', '']);
    expect(result.status).toBe(2);
    expect(result.stderr).toBe('✗ Unknown option for check. Did you mean "--log"?\n→ system-one-skills check --help\n');
  });
  test('specific errors pass through instead of one generic line', () => {
    expect(run(['check']).stderr).toBe('✗ check needs a command after --.\n→ system-one-skills check -- npm test\n');
    expect(run(['install-skills']).stderr).toBe('✗ install-skills needs a --target folder.\n→ system-one-skills install-skills --help\n');
    expect(run(['check', '--timeout-ms', '0', '--', node, '-e', '']).stderr).toBe('✗ --timeout-ms must be a whole number from 1 to 900000.\n→ system-one-skills check --help\n');
    expect(run(['check', '--log', 'a', '--log', 'b', '--', node, '-e', '']).stderr).toBe('✗ The --log option was given twice.\n→ system-one-skills check --help\n');
    const existing = join(scratch, 'existing.log');
    writeFileSync(existing, 'keep');
    const refused = run(['check', '--log', existing, '--', node, '-e', '']);
    expect(refused.status).toBe(2);
    expect(refused.stderr).toBe('✗ The log file already exists, so the command did not run.\n→ system-one-skills check --log <new-path> -- <command>\n');
    expect(refused.stderr).not.toContain(existing);
    expect(run(['check', '--log', join(scratch, 'missing-dir', 'x.log'), '--', node, '-e', '']).stderr).toBe("✗ Couldn't create the log file: its folder is missing or not writable.\n→ system-one-skills check --help\n");
  });
  test('a changed installed skill is explained and preserved', () => {
    const target = join(scratch, 'skills');
    expect(run(['install-skills', '--target', target]).stdout).toBe('✓ Installed system-one-verify.\n');
    expect(run(['install-skills', '--target', target]).stdout).toBe('✓ system-one-verify is already installed and up to date.\n');
    writeFileSync(join(target, 'system-one-verify', 'SKILL.md'), 'local edit');
    const result = run(['install-skills', '--target', target]);
    expect(result.status).toBe(2);
    expect(result.stderr).toBe('✗ A changed copy of system-one-verify is already in that folder, so nothing was installed. Keep your copy, or pick an empty folder.\n→ system-one-skills install-skills --target <empty-dir>\n');
    expect(result.stderr).not.toContain(target);
  });
});

describe('terminals', () => {
  test('NO_COLOR and non-TTY output keep symbols and add no color', () => {
    for (const env of [{ NO_COLOR: '1' }, {}]) {
      const result = run(['chek'], env);
      expect(result.stderr).not.toContain('\x1b[');
      expect(result.stderr.startsWith('✗ ')).toBe(true);
    }
  });
  test('FORCE_COLOR colors only the symbol', () => {
    const result = run(['chek'], { FORCE_COLOR: '1' });
    expect(result.stderr).toBe('\x1b[31m✗\x1b[0m Unknown command. Did you mean "check"?\n\x1b[2m→\x1b[0m system-one-skills --help\n');
  });
  test('TERM=dumb, a non-UTF-8 locale and HRANESS_ASCII use ASCII symbols', () => {
    for (const env of [{ TERM: 'dumb' }, { LANG: 'C' }, { HRANESS_ASCII: '1' }]) {
      const result = run(['chek'], env);
      expect(result.stderr).toBe('FAIL Unknown command. Did you mean "check"?\n-> system-one-skills --help\n');
    }
    expect(run(['install-skills', '--target', join(scratch, 'ascii-skills')], { HRANESS_ASCII: '1' }).stdout).toBe('OK Installed system-one-verify.\n');
  });
  test('the Next: hint is for people at a terminal only', () => {
    const target = join(scratch, 'agent-skills');
    const agent = run(['install-skills', '--target', target], { CLAUDECODE: '1' });
    expect(agent.stderr).toBe('');
    const human = run(['install-skills', '--target', join(scratch, 'human-skills')], { HRANESS_AUDIENCE: 'human' });
    expect(human.stderr).toBe('Next: system-one-skills check -- npm test\n');
  });
});
