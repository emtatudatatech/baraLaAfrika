import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

/*
 * Guards against .gitignore patterns that silently hide source files (an unanchored `coverage/`
 * once hid apps/web/src/features/coverage, so a fresh clone could not build). Only caches and
 * build output may be ignored inside the source trees.
 */
const SOURCE_PATHS = [
  'apps/web/src',
  'apps/web/public',
  'apps/web/index.html',
  'packages',
  'netlify',
  'db',
  'pipelines',
  'e2e',
  'scripts',
  'config',
  'docs',
  '.github',
];

const ALLOWED = [
  /(^|\/)node_modules\//,
  /(^|\/)\.netlify\//,
  /(^|\/)(__pycache__|\.mypy_cache|\.ruff_cache|\.pytest_cache)\//,
  /\.pyc$/,
  /\.tsbuildinfo$/,
  /(^|\/)\.DS_Store$/,
];

function inGitRepo(): boolean {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe.runIf(inGitRepo())('.gitignore', () => {
  it('never ignores source files', () => {
    const output = execFileSync(
      'git',
      ['ls-files', '--others', '--ignored', '--exclude-standard', '--', ...SOURCE_PATHS],
      { encoding: 'utf8' },
    );
    const hidden = output
      .split('\n')
      .filter(Boolean)
      .filter((file) => !ALLOWED.some((pattern) => pattern.test(file)));
    expect(hidden).toEqual([]);
  });
});
