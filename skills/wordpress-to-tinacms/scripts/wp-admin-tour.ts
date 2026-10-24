/**
 * wp-admin tour — Playwright-driven WordPress editor discovery.
 *
 * Logs into /wp-admin with credentials from migration/.env.local, enumerates
 * post types, visits each Add-New screen to derive the editor's field schema,
 * and emits migration/schema.json. Finally triggers Tools → Export and saves
 * migration/wp-export.xml.
 *
 * Status: REFERENCE SCRIPT. Not yet tested against a real wp-admin — the
 * selectors below match standard WordPress 6.x+ markup but WAFs, custom
 * admin themes, and some plugins can shift them. First-time users should run
 * with { headless: false } to watch for breakage.
 *
 * Usage:
 *   npx playwright install chromium
 *   tsx wp-admin-tour.ts
 */

import { chromium, Page } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { config as loadEnv } from 'dotenv';
import path from 'node:path';

loadEnv({ path: path.join(process.cwd(), 'migration', '.env.local') });

const WP_ADMIN_URL = process.env.WP_ADMIN_URL;
const WP_USERNAME = process.env.WP_USERNAME;
const WP_PASSWORD = process.env.WP_PASSWORD;
const HEADLESS = process.env.HEADLESS !== 'false';

if (!WP_ADMIN_URL || !WP_USERNAME || !WP_PASSWORD) {
  throw new Error(
    'Missing WP_ADMIN_URL / WP_USERNAME / WP_PASSWORD in migration/.env.local'
  );
}

type TinaField = {
  type: 'string' | 'rich-text' | 'image' | 'datetime' | 'boolean' | 'number' | 'reference' | 'object';
  name: string;
  label: string;
  isTitle?: boolean;
  required?: boolean;
  list?: boolean;
  options?: string[];
  collections?: string[];
  fields?: TinaField[];
  ui?: Record<string, unknown>;
};

type PostTypeSchema = {
  name: string;
  label: string;
  menuIcon?: string;
  fields: TinaField[];
};

type Manifest = {
  generatedAt: string;
  siteUrl: string;
  wpVersion?: string;
  postTypes: PostTypeSchema[];
  taxonomies: { name: string; label: string; postTypes: string[] }[];
  plugins: { acf: boolean; yoast: boolean; rankMath: boolean };
};

async function login(page: Page): Promise<void> {
  const loginUrl = `${WP_ADMIN_URL!.replace(/\/wp-admin\/?$/, '')}/wp-login.php`;
  await page.goto(loginUrl);
  await page.fill('#user_login', WP_USERNAME!);
  await page.fill('#user_pass', WP_PASSWORD!);
  await page.click('#wp-submit');
  await page.waitForURL(/\/wp-admin\/?/);
}

async function detectWpVersion(page: Page): Promise<string | undefined> {
  const version = await page
    .locator('#footer-upgrade')
    .textContent()
    .catch(() => null);
  return version?.match(/Version\s+([\d.]+)/)?.[1];
}

async function enumeratePostTypes(page: Page): Promise<{ name: string; label: string; addNewUrl: string }[]> {
  // The admin left-menu renders each registered post type with class ending in -post or wp-menu-name
  // Standard WP: menu items with hrefs matching edit.php?post_type=<slug>
  const items = await page.$$eval('a[href*="edit.php"]', (anchors) =>
    anchors
      .map((a) => {
        const href = (a as HTMLAnchorElement).href;
        const m = href.match(/edit\.php(?:\?post_type=([a-z0-9_-]+))?/);
        if (!m) return null;
        const slug = m[1] ?? 'post';
        const label = a.textContent?.trim() ?? slug;
        return { slug, label, href };
      })
      .filter((x): x is { slug: string; label: string; href: string } => !!x)
  );
  // dedupe
  const seen = new Set<string>();
  const unique = items.filter((i) => {
    if (seen.has(i.slug)) return false;
    seen.add(i.slug);
    return true;
  });
  return unique.map((i) => ({
    name: i.slug,
    label: i.label,
    addNewUrl: `${WP_ADMIN_URL!.replace(/\/$/, '')}/post-new.php?post_type=${i.slug}`,
  }));
}

async function derivePostTypeSchema(page: Page, slug: string, label: string, addNewUrl: string): Promise<PostTypeSchema> {
  await page.goto(addNewUrl);
  const fields: TinaField[] = [
    { type: 'string', name: 'title', label: 'Title', isTitle: true, required: true },
  ];

  // Block editor is loaded if the .block-editor-writing-flow container exists
  const hasBlockEditor = (await page.locator('.block-editor-writing-flow').count()) > 0;
  if (hasBlockEditor) {
    fields.push({ type: 'rich-text', name: 'body', label: 'Content' });
  } else if ((await page.locator('#content').count()) > 0) {
    fields.push({ type: 'rich-text', name: 'body', label: 'Content' });
  }

  // Excerpt panel (both classic & block editor)
  if ((await page.locator('#excerpt, .editor-post-excerpt').count()) > 0) {
    fields.push({ type: 'string', name: 'excerpt', label: 'Excerpt', ui: { component: 'textarea' } });
  }

  // Featured image
  if ((await page.locator('#postimagediv, .editor-post-featured-image').count()) > 0) {
    fields.push({ type: 'image', name: 'featured_image', label: 'Featured Image' });
  }

  // Categories (post + any CPT that opted-in)
  if ((await page.locator('#categorydiv, .editor-post-taxonomies__hierarchical-terms-list').count()) > 0) {
    fields.push({ type: 'reference', name: 'categories', label: 'Categories', list: true, collections: ['category'] });
  }

  // Tags
  if ((await page.locator('#tagsdiv-post_tag, .editor-post-taxonomies__flat-term-most-used').count()) > 0) {
    fields.push({ type: 'reference', name: 'tags', label: 'Tags', list: true, collections: ['tag'] });
  }

  // Any metabox that isn't core — likely plugin-added custom fields
  const customMetaboxes = await page.$$eval('.postbox', (boxes) =>
    boxes
      .map((b) => ({
        id: b.id,
        title: b.querySelector('.hndle')?.textContent?.trim() ?? '',
      }))
      .filter((b) => !['postdivrich', 'postexcerpt', 'postimagediv', 'categorydiv', 'tagsdiv-post_tag', 'submitdiv', 'slugdiv', 'authordiv', 'commentstatusdiv', 'commentsdiv', 'postcustom', 'trackbacksdiv', 'revisionsdiv'].includes(b.id))
  );

  for (const box of customMetaboxes) {
    fields.push({
      type: 'string',
      name: box.id.replace(/[^a-z0-9_]/gi, '_').toLowerCase(),
      label: box.title,
      ui: { component: 'textarea' },
    });
    // TODO: per-plugin heuristics go here. See admin-tour.md "Extending for a specific plugin".
  }

  return { name: slug, label, fields };
}

async function enumerateTaxonomies(page: Page): Promise<Manifest['taxonomies']> {
  // Visit /wp-admin/options-general.php?page=... — doesn't universally expose taxonomies.
  // Simpler: parse the admin menu for edit-tags.php links.
  const items = await page.$$eval('a[href*="edit-tags.php"]', (anchors) =>
    anchors
      .map((a) => {
        const href = (a as HTMLAnchorElement).href;
        const m = href.match(/edit-tags\.php\?taxonomy=([a-z0-9_-]+)(?:&post_type=([a-z0-9_-]+))?/);
        if (!m) return null;
        return { name: m[1], label: a.textContent?.trim() ?? m[1], postType: m[2] };
      })
      .filter((x): x is { name: string; label: string; postType: string | undefined } => !!x)
  );
  const grouped = new Map<string, Manifest['taxonomies'][number]>();
  for (const i of items) {
    const existing = grouped.get(i.name);
    if (existing) {
      if (i.postType && !existing.postTypes.includes(i.postType)) existing.postTypes.push(i.postType);
    } else {
      grouped.set(i.name, { name: i.name, label: i.label, postTypes: i.postType ? [i.postType] : [] });
    }
  }
  return [...grouped.values()];
}

async function detectPlugins(page: Page): Promise<Manifest['plugins']> {
  await page.goto(`${WP_ADMIN_URL!.replace(/\/$/, '')}/plugins.php`);
  const activePlugins = await page.$$eval('tr.active', (rows) =>
    rows.map((r) => r.getAttribute('data-slug') ?? r.querySelector('.plugin-title strong')?.textContent?.trim() ?? '').filter(Boolean)
  );
  return {
    acf: activePlugins.some((p) => /^(advanced-custom-fields|acf)/i.test(p)),
    yoast: activePlugins.some((p) => /wordpress-seo|yoast/i.test(p)),
    rankMath: activePlugins.some((p) => /^seo-by-rank-math/i.test(p)),
  };
}

async function exportContent(page: Page): Promise<void> {
  await page.goto(`${WP_ADMIN_URL!.replace(/\/$/, '')}/export.php`);
  // The default radio is "All content" — just submit the form.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#submit'),
  ]);
  await download.saveAs(path.join(process.cwd(), 'migration', 'wp-export.xml'));
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('[tour] logging in…');
  await login(page);

  console.log('[tour] detecting WordPress version…');
  const wpVersion = await detectWpVersion(page);

  console.log('[tour] enumerating post types…');
  const postTypes = await enumeratePostTypes(page);
  console.log(`[tour]   found ${postTypes.length}: ${postTypes.map((p) => p.name).join(', ')}`);

  console.log('[tour] deriving schema per post type…');
  const schemas: PostTypeSchema[] = [];
  for (const pt of postTypes) {
    if (pt.name === 'attachment') continue; // media library, not a content type
    console.log(`[tour]   ${pt.name}…`);
    schemas.push(await derivePostTypeSchema(page, pt.name, pt.label, pt.addNewUrl));
  }

  console.log('[tour] enumerating taxonomies…');
  const taxonomies = await enumerateTaxonomies(page);

  console.log('[tour] detecting plugins…');
  const plugins = await detectPlugins(page);

  const manifest: Manifest = {
    generatedAt: new Date().toISOString(),
    siteUrl: WP_ADMIN_URL!.replace(/\/wp-admin\/?$/, ''),
    wpVersion,
    postTypes: schemas,
    taxonomies,
    plugins,
  };

  const outPath = path.join(process.cwd(), 'migration', 'schema.json');
  await writeFile(outPath, JSON.stringify(manifest, null, 2));
  console.log(`[tour] schema written to ${outPath}`);

  console.log('[tour] exporting content…');
  try {
    await exportContent(page);
    console.log('[tour] content exported to migration/wp-export.xml');
  } catch (err) {
    console.warn('[tour] export failed, user needs to do it manually:', (err as Error).message);
  }

  await browser.close();
  console.log('[tour] done.');
}

main().catch((err) => {
  console.error('[tour] fatal:', err);
  process.exit(1);
});
