/**
 * wp-admin tour — Playwright-driven WordPress editor discovery.
 *
 * Logs into /wp-admin with credentials from migration/.env.local, enumerates
 * post types, visits each Add-New screen to derive the editor's field schema,
 * reads ACF field groups (via ACF → Tools → Export) and Yoast / Rank Math SEO
 * metaboxes, and emits migration/schema.json. Finally triggers Tools → Export
 * and saves migration/wp-export.xml.
 *
 * Read-only: the tour never saves a post, changes a setting, or installs
 * anything. Opening an Add-New screen creates a WordPress auto-draft, which
 * WordPress garbage-collects on its own after 7 days.
 *
 * Tested against the local test site in test-sites/wordpress (WordPress 7.1,
 * ACF 6.8 free, Yoast SEO 28.7). Rank Math detection is untested. Run with
 * HEADLESS=false to watch it the first time on a new site.
 *
 * Usage (from the migration working directory):
 *   npm i -D playwright dotenv @types/node typescript tsx
 *   npx playwright install chromium
 *   npx tsx migration/wp-admin-tour.ts
 */

import { chromium, Page } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { config as loadEnv } from 'dotenv';
import path from 'node:path';

const MIGRATION_DIR = path.join(process.cwd(), 'migration');
loadEnv({ path: path.join(MIGRATION_DIR, '.env.local') });

const WP_ADMIN_URL = process.env.WP_ADMIN_URL?.replace(/\/$/, '');
const WP_USERNAME = process.env.WP_USERNAME;
const WP_PASSWORD = process.env.WP_PASSWORD;
const HEADLESS = process.env.HEADLESS !== 'false';

if (!WP_ADMIN_URL || !WP_USERNAME || !WP_PASSWORD) {
  throw new Error('Missing WP_ADMIN_URL / WP_USERNAME / WP_PASSWORD in migration/.env.local');
}

const SITE_URL = WP_ADMIN_URL.replace(/\/wp-admin$/, '');

// Post types that are WordPress or plugin internals, not editorial content.
const INTERNAL_POST_TYPES = new Set([
  'attachment', 'wp_block', 'wp_navigation', 'wp_template', 'wp_template_part', 'wp_font_family',
  'acf-field-group', 'acf-post-type', 'acf-taxonomy', 'acf-ui-options-page',
]);
const INTERNAL_TAXONOMIES = new Set(['post_format', 'nav_menu', 'link_category', 'wp_pattern_category', 'wp_theme', 'wp_template_part_area']);

/**
 * Where a field's value lives in WordPress. Not part of the Tina schema —
 * the collection generator strips it; the content transformer uses it to
 * read values out of wp-export.xml.
 */
type FieldSource =
  | { kind: 'core'; wpField: string }
  | { kind: 'taxonomy'; taxonomy: string }
  | { kind: 'acf'; key: string; metaKey: string; acfType: string }
  | { kind: 'acf-group'; key: string }
  | { kind: 'seo'; plugin: 'yoast' | 'rank-math'; metaKey?: string };

type TinaOption = string | { value: string; label: string };

type TinaField = {
  type: 'string' | 'rich-text' | 'image' | 'datetime' | 'boolean' | 'number' | 'reference' | 'object';
  name: string;
  label: string;
  description?: string;
  isTitle?: boolean;
  required?: boolean;
  list?: boolean;
  options?: TinaOption[];
  collections?: string[];
  fields?: TinaField[];
  ui?: Record<string, unknown>;
  source?: FieldSource;
};

type PostTypeSchema = {
  name: string;
  label: string;
  editor: 'block' | 'classic';
  fields: TinaField[];
  /** Metaboxes the tour saw but couldn't map. Review these with the user — don't guess. */
  unmapped: { id: string; title: string }[];
};

type Taxonomy = { name: string; label: string; hierarchical: boolean; postTypes: string[] };

type Manifest = {
  generatedAt: string;
  siteUrl: string;
  wpVersion?: string;
  postTypes: PostTypeSchema[];
  taxonomies: Taxonomy[];
  plugins: { acf: boolean; yoast: boolean; rankMath: boolean; active: string[] };
};

type AcfField = {
  key: string;
  label: string;
  name: string;
  type: string;
  instructions?: string;
  required?: number | boolean;
  choices?: Record<string, string>;
  multiple?: number | boolean;
  post_type?: string[] | string;
  taxonomy?: string;
  field_type?: string;
  sub_fields?: AcfField[];
  layouts?: Record<string, { name: string; label: string; sub_fields: AcfField[] }> | { name: string; label: string; sub_fields: AcfField[] }[];
};

type AcfFieldGroup = {
  key: string;
  title: string;
  fields: AcfField[];
  location: { param: string; operator: string; value: string }[][];
  active?: boolean | number;
};

const toTinaName = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');

// ---------------------------------------------------------------------------
// Login + site-level discovery
// ---------------------------------------------------------------------------

async function login(page: Page): Promise<void> {
  await page.goto(`${SITE_URL}/wp-login.php`);
  await page.fill('#user_login', WP_USERNAME!);
  await page.fill('#user_pass', WP_PASSWORD!);
  await Promise.all([page.waitForLoadState('domcontentloaded'), page.click('#wp-submit')]);
  if ((await page.locator('#login_error').count()) > 0) {
    throw new Error('Login rejected — check WP_USERNAME / WP_PASSWORD (2FA? see admin-tour.md)');
  }
  // Some plugins redirect to an onboarding page after login; land on the dashboard so the admin menu is there.
  await page.goto(`${WP_ADMIN_URL}/`);
  if ((await page.locator('#adminmenu').count()) === 0) {
    throw new Error(`Logged in but no admin menu at ${page.url()} — WAF or SSO in the way?`);
  }
}

async function detectWpVersion(page: Page): Promise<string | undefined> {
  const footer = await page.locator('#footer-upgrade').textContent().catch(() => null);
  return footer?.match(/([\d]+\.[\d.]+)/)?.[1];
}

async function detectPlugins(page: Page): Promise<Manifest['plugins']> {
  await page.goto(`${WP_ADMIN_URL}/plugins.php?plugin_status=active`);
  const active = await page.$$eval('tr.active[data-slug]', (rows) =>
    rows.map((r) => r.getAttribute('data-slug')!).filter(Boolean)
  );
  return {
    acf: active.some((p) => /^advanced-custom-fields/.test(p)),
    yoast: active.includes('wordpress-seo') || active.includes('wordpress-seo-premium'),
    rankMath: active.includes('seo-by-rank-math'),
    active,
  };
}

async function enumeratePostTypes(page: Page): Promise<{ name: string; label: string }[]> {
  await page.goto(`${WP_ADMIN_URL}/`);
  // Top-level admin menu items only — submenus (All Posts, Categories, plugin pages) are noise.
  const items = await page.$$eval('#adminmenu > li > a.menu-top', (anchors) =>
    anchors.map((a) => ({
      href: (a as HTMLAnchorElement).href,
      label: a.querySelector('.wp-menu-name')?.childNodes[0]?.textContent?.trim() ?? '',
    }))
  );
  const seen = new Set<string>();
  const types: { name: string; label: string }[] = [];
  for (const { href, label } of items) {
    const url = new URL(href);
    if (!url.pathname.endsWith('/edit.php')) continue;
    const name = url.searchParams.get('post_type') ?? 'post';
    if (INTERNAL_POST_TYPES.has(name) || seen.has(name)) continue;
    seen.add(name);
    types.push({ name, label: label || name });
  }
  return types;
}

/** Reads every ACF field group the same way an admin would: ACF → Tools → Export As JSON. */
async function readAcfFieldGroups(page: Page): Promise<AcfFieldGroup[]> {
  await page.goto(`${WP_ADMIN_URL}/edit.php?post_type=acf-field-group&page=acf-tools`);
  const boxes = page.locator('input[type="checkbox"][name="keys[]"]');
  const count = await boxes.count();
  if (count === 0) {
    console.warn('[tour]   ACF is active but the export tool lists no field groups (local JSON / PHP-registered?) — see admin-tour.md');
    return [];
  }
  for (let i = 0; i < count; i++) await boxes.nth(i).check();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('button[name="action"][value="download"], input[name="action"][value="download"]'),
  ]);
  const out = path.join(MIGRATION_DIR, 'acf-field-groups.json');
  await download.saveAs(out);
  const groups: AcfFieldGroup[] = JSON.parse(await readFile(out, 'utf8'));
  return groups.filter((g) => g.active !== false && g.active !== 0);
}

// ---------------------------------------------------------------------------
// ACF → Tina mapping (see schema-mapping.md)
// ---------------------------------------------------------------------------

const taxonomyCollection = (tax: string) => (tax === 'post_tag' ? 'tag' : tax);

/** Tina reference fields can't be lists — a list of references is an object list wrapping one reference. */
function referenceField(name: string, label: string, collections: string[], list: boolean): TinaField {
  if (!list) return { type: 'reference', name, label, collections };
  return {
    type: 'object',
    name,
    label,
    list: true,
    fields: [{ type: 'reference', name: 'item', label: label.replace(/ies$/, 'y').replace(/s$/, ''), collections }],
  };
}

function acfToTina(f: AcfField, postTypeNames: string[], skipped: string[]): TinaField | null {
  const name = toTinaName(f.name);
  const base = {
    name,
    label: f.label,
    ...(f.instructions ? { description: f.instructions } : {}),
    ...(f.required ? { required: true } : {}),
  };
  const source: FieldSource = { kind: 'acf', key: f.key, metaKey: f.name, acfType: f.type };
  const options = (): TinaOption[] =>
    Object.entries(f.choices ?? {}).map(([value, label]) => (value === label ? value : { value, label }));
  const targets = (): string[] => {
    const pt = f.post_type;
    const list = Array.isArray(pt) ? pt : pt ? [pt] : [];
    return list.length ? list : postTypeNames;
  };
  const children = (subs: AcfField[] = []) =>
    subs.map((s) => acfToTina(s, postTypeNames, skipped)).filter((x): x is TinaField => !!x);

  let field: TinaField | null;
  switch (f.type) {
    case 'text':
    case 'email':
    case 'url':
    case 'oembed':
    case 'color_picker':
    case 'time_picker':
      field = { ...base, type: 'string' };
      break;
    case 'textarea':
      field = { ...base, type: 'string', ui: { component: 'textarea' } };
      break;
    case 'number':
    case 'range':
      field = { ...base, type: 'number' };
      break;
    case 'image':
    case 'file':
      field = { ...base, type: 'image' };
      break;
    case 'gallery':
      field = { ...base, type: 'image', list: true };
      break;
    case 'wysiwyg':
      field = { ...base, type: 'rich-text' };
      break;
    case 'select':
      field = { ...base, type: 'string', options: options(), ...(f.multiple ? { list: true } : {}) };
      break;
    case 'radio':
    case 'button_group':
      field = { ...base, type: 'string', options: options() };
      break;
    case 'checkbox':
      field = { ...base, type: 'string', list: true, options: options() };
      break;
    case 'true_false':
      field = { ...base, type: 'boolean' };
      break;
    case 'date_picker':
    case 'date_time_picker':
      field = { ...base, type: 'datetime' };
      break;
    case 'link':
      field = {
        ...base,
        type: 'object',
        fields: [
          { type: 'string', name: 'title', label: 'Link text' },
          { type: 'string', name: 'url', label: 'URL' },
          { type: 'string', name: 'target', label: 'Target', options: ['', '_blank'] },
        ],
      };
      break;
    case 'google_map':
      field = {
        ...base,
        type: 'object',
        fields: [
          { type: 'string', name: 'address', label: 'Address' },
          { type: 'number', name: 'lat', label: 'Latitude' },
          { type: 'number', name: 'lng', label: 'Longitude' },
        ],
      };
      break;
    case 'post_object':
    case 'page_link':
      field = { ...referenceField(name, f.label, targets(), !!f.multiple), ...base };
      break;
    case 'relationship':
      field = { ...referenceField(name, f.label, targets(), true), ...base };
      break;
    case 'taxonomy': {
      const multi = f.field_type === 'checkbox' || f.field_type === 'multi_select';
      field = { ...referenceField(name, f.label, [taxonomyCollection(f.taxonomy ?? 'category')], multi), ...base };
      break;
    }
    case 'group':
      field = { ...base, type: 'object', fields: children(f.sub_fields) };
      break;
    case 'repeater':
      field = { ...base, type: 'object', list: true, fields: children(f.sub_fields) };
      break;
    case 'flexible_content': {
      const layouts = Array.isArray(f.layouts) ? f.layouts : Object.values(f.layouts ?? {});
      field = {
        ...base,
        type: 'object',
        list: true,
        // Tina uses `templates` for flexible lists; kept under `ui` here so the type stays simple.
        ui: {
          templates: layouts.map((l) => ({ name: toTinaName(l.name), label: l.label, fields: children(l.sub_fields) })),
        },
      };
      break;
    }
    // Layout-only or out-of-scope types: no data to migrate.
    case 'tab':
    case 'accordion':
    case 'message':
      return null;
    case 'password':
    case 'user':
    case 'clone':
    default:
      skipped.push(`${f.label || f.name} (ACF ${f.type})`);
      return null;
  }
  return { ...field, source };
}

/** Which post types an ACF group targets via `post_type ==` location rules. */
function acfGroupPostTypes(group: AcfFieldGroup): Set<string> {
  const types = new Set<string>();
  for (const andRules of group.location ?? []) {
    for (const rule of andRules) {
      if (rule.param === 'post_type' && rule.operator === '==') types.add(rule.value);
    }
  }
  return types;
}

// ---------------------------------------------------------------------------
// SEO plugins (see schema-mapping.md → "Yoast / Rank Math SEO")
// ---------------------------------------------------------------------------

function seoField(plugin: 'yoast' | 'rank-math'): TinaField {
  const keys =
    plugin === 'yoast'
      ? { title: '_yoast_wpseo_title', description: '_yoast_wpseo_metadesc', canonical: '_yoast_wpseo_canonical', og_image: '_yoast_wpseo_opengraph-image', noindex: '_yoast_wpseo_meta-robots-noindex' }
      : { title: 'rank_math_title', description: 'rank_math_description', canonical: 'rank_math_canonical_url', og_image: 'rank_math_facebook_image', noindex: 'rank_math_robots' };
  const s = (metaKey: string): FieldSource => ({ kind: 'seo', plugin, metaKey });
  return {
    type: 'object',
    name: 'seo',
    label: 'SEO',
    source: { kind: 'seo', plugin },
    fields: [
      { type: 'string', name: 'title', label: 'SEO Title', source: s(keys.title) },
      { type: 'string', name: 'description', label: 'Meta Description', ui: { component: 'textarea' }, source: s(keys.description) },
      { type: 'string', name: 'canonical', label: 'Canonical URL', source: s(keys.canonical) },
      { type: 'image', name: 'og_image', label: 'Social Share Image', source: s(keys.og_image) },
      { type: 'boolean', name: 'noindex', label: 'Hide from search engines', source: s(keys.noindex) },
    ],
  };
}

// ---------------------------------------------------------------------------
// Per-post-type schema
// ---------------------------------------------------------------------------

type ScreenInfo = {
  editor: 'block' | 'classic';
  supports: Record<string, boolean>;
  taxonomies: { name: string; label: string; hierarchical: boolean }[];
  metaboxes: { id: string; title: string }[];
};

async function readAddNewScreen(page: Page, slug: string): Promise<ScreenInfo> {
  await page.goto(`${WP_ADMIN_URL}/post-new.php?post_type=${slug}`);
  // Meta boxes (ACF, Yoast, plugins) are server-rendered on both editors, so they're in the DOM straight away.
  const metaboxes = await page.$$eval('.postbox[id]', (boxes) =>
    boxes.map((b) => ({ id: b.id, title: b.querySelector('.hndle, h2')?.textContent?.trim() ?? '' }))
  );

  if ((await page.locator('body.block-editor-page').count()) > 0) {
    // Block editor: ask its own data store — the same source that decides which panels the editor shows.
    await page.waitForFunction(() => !!(window as any).wp?.data?.resolveSelect);
    const info = await page.evaluate(async (slug) => {
      const core = (window as any).wp.data.resolveSelect('core');
      const type = await core.getPostType(slug);
      const taxonomies = await Promise.all(
        (type?.taxonomies ?? []).map(async (t: string) => {
          const tax = await core.getTaxonomy(t);
          return { name: t, label: tax?.name ?? t, hierarchical: !!tax?.hierarchical };
        })
      );
      return { supports: type?.supports ?? {}, taxonomies };
    }, slug);
    return { editor: 'block', ...info, metaboxes };
  }

  // Classic editor: read the form itself.
  const supports = {
    title: (await page.locator('#title').count()) > 0,
    editor: (await page.locator('#postdivrich').count()) > 0,
    excerpt: (await page.locator('#postexcerpt').count()) > 0,
    thumbnail: (await page.locator('#postimagediv').count()) > 0,
    author: (await page.locator('#authordiv').count()) > 0,
  };
  const taxonomies = await page.$$eval('.postbox[id]', (boxes) =>
    boxes.flatMap((b) => {
      const label = b.querySelector('.hndle, h2')?.textContent?.trim() ?? '';
      const flat = b.id.match(/^tagsdiv-(.+)$/);
      if (flat) return [{ name: flat[1], label, hierarchical: false }];
      const tree = b.querySelector('.categorydiv[id^="taxonomy-"]');
      if (tree) return [{ name: tree.id.replace(/^taxonomy-/, ''), label, hierarchical: true }];
      return [];
    })
  );
  return { editor: 'classic', supports, taxonomies, metaboxes };
}

// Metaboxes WordPress core renders. Anything else came from a plugin or the theme.
const CORE_METABOXES = new Set([
  'submitdiv', 'postdivrich', 'postexcerpt', 'postimagediv', 'slugdiv', 'authordiv', 'commentstatusdiv',
  'commentsdiv', 'postcustom', 'trackbacksdiv', 'revisionsdiv', 'pageparentdiv', 'formatdiv',
]);

function buildPostTypeSchema(
  pt: { name: string; label: string },
  screen: ScreenInfo,
  ctx: { acfGroups: AcfFieldGroup[]; plugins: Manifest['plugins']; postTypeNames: string[]; skipped: string[] }
): PostTypeSchema {
  const { supports } = screen;
  const fields: TinaField[] = [];
  if (supports.title !== false) {
    fields.push({ type: 'string', name: 'title', label: 'Title', isTitle: true, required: true, source: { kind: 'core', wpField: 'post_title' } });
  }
  fields.push({ type: 'datetime', name: 'date', label: 'Publish date', source: { kind: 'core', wpField: 'post_date' } });
  if (supports.excerpt) {
    fields.push({ type: 'string', name: 'excerpt', label: 'Excerpt', ui: { component: 'textarea' }, source: { kind: 'core', wpField: 'post_excerpt' } });
  }
  if (supports.thumbnail) {
    fields.push({ type: 'image', name: 'featured_image', label: 'Featured Image', source: { kind: 'core', wpField: '_thumbnail_id' } });
  }

  const handled = new Set<string>();
  for (const tax of screen.taxonomies) {
    if (INTERNAL_TAXONOMIES.has(tax.name)) continue;
    const name = tax.name === 'category' ? 'categories' : tax.name === 'post_tag' ? 'tags' : toTinaName(tax.name);
    fields.push({ ...referenceField(name, tax.label, [taxonomyCollection(tax.name)], true), source: { kind: 'taxonomy', taxonomy: tax.name } });
    handled.add(tax.hierarchical ? `${tax.name}div` : `tagsdiv-${tax.name}`);
    if (tax.name === 'category') handled.add('categorydiv');
  }

  // ACF: one Tina object per field group, mirroring the metabox the editor sees.
  const onScreen = new Set(screen.metaboxes.map((m) => m.id));
  for (const group of ctx.acfGroups) {
    if (!onScreen.has(`acf-${group.key}`) && !acfGroupPostTypes(group).has(pt.name)) continue;
    handled.add(`acf-${group.key}`);
    const groupFields = group.fields
      .map((f) => acfToTina(f, ctx.postTypeNames, ctx.skipped))
      .filter((x): x is TinaField => !!x);
    if (groupFields.length === 0) continue;
    fields.push({ type: 'object', name: toTinaName(group.title), label: group.title, fields: groupFields, source: { kind: 'acf-group', key: group.key } });
  }

  // SEO plugin metabox → single `seo` object.
  if (ctx.plugins.yoast && onScreen.has('wpseo_meta')) {
    fields.push(seoField('yoast'));
    handled.add('wpseo_meta');
  } else if (ctx.plugins.rankMath && (onScreen.has('rank_math_metabox') || screen.editor === 'block')) {
    // Rank Math renders in a block-editor sidebar, not a metabox — untested, verify on a real site.
    fields.push(seoField('rank-math'));
    handled.add('rank_math_metabox');
  }

  // Body last, so the frontmatter fields come first — matches Tina's own starters.
  if (supports.editor) {
    fields.push({ type: 'rich-text', name: 'body', label: 'Content', source: { kind: 'core', wpField: 'post_content' } });
  }

  const unmapped = screen.metaboxes.filter((m) => !CORE_METABOXES.has(m.id) && !handled.has(m.id) && !m.id.startsWith('acf-'));
  return { name: pt.name, label: pt.label, editor: screen.editor, fields, unmapped };
}

// ---------------------------------------------------------------------------
// Export + main
// ---------------------------------------------------------------------------

async function exportContent(page: Page): Promise<void> {
  await page.goto(`${WP_ADMIN_URL}/export.php`);
  // The default radio is "All content" — just submit the form.
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#submit')]);
  await download.saveAs(path.join(MIGRATION_DIR, 'wp-export.xml'));
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  console.log('[tour] logging in…');
  await login(page);
  const wpVersion = await detectWpVersion(page);
  console.log(`[tour]   WordPress ${wpVersion ?? '(version hidden)'}`);

  console.log('[tour] detecting plugins…');
  const plugins = await detectPlugins(page);
  console.log(`[tour]   ACF: ${plugins.acf}, Yoast: ${plugins.yoast}, Rank Math: ${plugins.rankMath}`);

  console.log('[tour] enumerating post types…');
  const postTypes = await enumeratePostTypes(page);
  console.log(`[tour]   found ${postTypes.length}: ${postTypes.map((p) => p.name).join(', ')}`);

  const acfGroups = plugins.acf ? await readAcfFieldGroups(page) : [];
  if (plugins.acf) console.log(`[tour]   ACF field groups: ${acfGroups.map((g) => g.title).join(', ') || 'none'}`);

  const skipped: string[] = [];
  const ctx = { acfGroups, plugins, postTypeNames: postTypes.map((p) => p.name), skipped };
  const schemas: PostTypeSchema[] = [];
  const taxonomies = new Map<string, Taxonomy>();
  for (const pt of postTypes) {
    console.log(`[tour] reading ${pt.name} editor…`);
    const screen = await readAddNewScreen(page, pt.name);
    schemas.push(buildPostTypeSchema(pt, screen, ctx));
    for (const t of screen.taxonomies) {
      if (INTERNAL_TAXONOMIES.has(t.name)) continue;
      const existing = taxonomies.get(t.name) ?? { ...t, postTypes: [] };
      existing.postTypes.push(pt.name);
      taxonomies.set(t.name, existing);
    }
  }

  const manifest: Manifest = {
    generatedAt: new Date().toISOString(),
    siteUrl: SITE_URL,
    wpVersion,
    postTypes: schemas,
    taxonomies: [...taxonomies.values()],
    plugins,
  };
  const outPath = path.join(MIGRATION_DIR, 'schema.json');
  await writeFile(outPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`[tour] schema written to ${outPath}`);

  for (const s of schemas) {
    for (const m of s.unmapped) console.warn(`[tour]   UNMAPPED on ${s.name}: metabox "${m.title}" (#${m.id})`);
  }
  for (const s of new Set(skipped)) console.warn(`[tour]   SKIPPED field: ${s}`);

  console.log('[tour] exporting content…');
  try {
    await exportContent(page);
    console.log('[tour]   content exported to migration/wp-export.xml');
  } catch (err) {
    console.warn('[tour]   export failed, user needs to do it manually:', (err as Error).message);
  }

  await browser.close();
  console.log('[tour] done.');
}

main().catch((err) => {
  console.error('[tour] fatal:', err);
  process.exit(1);
});
