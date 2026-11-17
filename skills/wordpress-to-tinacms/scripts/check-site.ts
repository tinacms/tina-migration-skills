/**
 * Check the migrated site is up: request every migrated entry and term at its
 * new URL, the homepage and the TinaCMS editor, and confirm every old WordPress
 * URL that changed redirects to its new address. Reads the URLs from
 * migration/transform-report.json.
 *
 * Exits 1 if any request fails, so it can gate the end of a run.
 *
 * Usage (from the project root, with `pnpm dev` running):
 *   migration/node_modules/.bin/tsx migration/check-site.ts [base-url]   # default http://localhost:4321
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = (process.argv[2] ?? 'http://localhost:4321').replace(/\/$/, '');

const samePath = (a: string, b: string) => a.replace(/\/$/, '') === b.replace(/\/$/, '');

/** Astro answers redirects with a 3xx from a server and a meta-refresh page from a static build. */
async function nextHop(res: Response, html: string): Promise<string | undefined> {
  if (res.status >= 300 && res.status < 400) return res.headers.get('location') ?? undefined;
  return html.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*url=([^"'>\s]+)/i)?.[1];
}

/** Follow an old URL one hop at a time. Returns what's wrong with it, or nothing if it lands on `target`. */
async function checkRedirect(from: string, target: string): Promise<string | undefined> {
  let current = from;
  for (let hops = 0; hops < 5; hops++) {
    const res = await fetch(BASE + current, { redirect: 'manual' });
    const hop = await nextHop(res, res.ok ? await res.text() : '');
    if (!hop) {
      if (hops === 0) return `${res.status} ${from}: expected a redirect to ${target}, got none`;
      if (!samePath(current, target)) return `${from}: redirects to ${current}, expected ${target}`;
      return res.ok ? undefined : `${res.status} ${from}: redirect target ${target} failed`;
    }
    current = new URL(hop, BASE + current).pathname;
  }
  return `${from}: too many redirects`;
}

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

  // transform-content.ts gives no redirect to `/` or to an old URL another entry now uses.
  const redirects = report.urlMismatches.filter((m) => m.old !== '/' && !seen.has(m.old));
  for (const m of redirects) {
    const problem = await checkRedirect(m.old, m.new);
    if (problem) failed.push(problem);
  }

  const total = seen.size + redirects.length;
  console.log(`[check] ${total - failed.length}/${total} URLs OK on ${BASE} (${redirects.length} redirects)`);
  for (const f of failed) console.error(`[check]   FAILED: ${f}`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error('[check] fatal:', err.message ?? err);
  process.exit(1);
});
