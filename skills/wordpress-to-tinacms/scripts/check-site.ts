/**
 * Check the migrated site is up: request every migrated entry at its new URL,
 * every old WordPress URL that changed (it should redirect), the homepage and
 * the TinaCMS editor. Reads the URLs from migration/transform-report.json.
 *
 * Exits 1 if any request fails, so it can gate the end of a run.
 *
 * Usage (from the project root, with `pnpm dev` running):
 *   migration/node_modules/.bin/tsx migration/check-site.ts [base-url]   # default http://localhost:4321
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = (process.argv[2] ?? 'http://localhost:4321').replace(/\/$/, '');

async function main(): Promise<void> {
  const report = JSON.parse(await readFile(path.join(process.cwd(), 'migration/transform-report.json'), 'utf8')) as {
    urls?: string[];
    urlMismatches: { old: string; new: string }[];
  };
  if (!report.urls) throw new Error('transform-report.json has no `urls` list. Re-run transform-content.ts.');

  const checks = [
    { url: '/', what: 'homepage' },
    { url: '/admin/index.html', what: 'TinaCMS editor' },
    ...report.urls.map((url) => ({ url, what: 'entry' })),
    ...report.urlMismatches.map((m) => ({ url: m.old, what: `old URL → ${m.new}` })),
  ];
  const seen = new Set<string>();
  const failed: string[] = [];
  for (const { url, what } of checks) {
    if (seen.has(url)) continue;
    seen.add(url);
    const res = await fetch(BASE + url).catch((err: Error) => err);
    if (res instanceof Error) throw new Error(`Can't reach ${BASE}. Is \`pnpm dev\` running? (${res.message})`);
    if (!res.ok) failed.push(`${res.status} ${url} (${what})`);
  }

  console.log(`[check] ${seen.size - failed.length}/${seen.size} URLs OK on ${BASE}`);
  for (const f of failed) console.error(`[check]   FAILED: ${f}`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error('[check] fatal:', err.message ?? err);
  process.exit(1);
});
