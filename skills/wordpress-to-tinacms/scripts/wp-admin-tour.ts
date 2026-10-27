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
 * No Administrator login? `--from-export` projects schema.json from an
 * export file someone else downloaded (Tools → Export → All content), saved
 * as migration/wp-export.xml, plus ACF's own JSON export if there is one
 * (migration/acf-field-groups.json). No browser, no credentials. The result
 * is a guess from stored values, not an observation of the editor.
 *
 * Usage (from the project root):
 *   migration/node_modules/.bin/tsx migration/wp-admin-tour.ts --check         # login + permissions only, writes nothing
 *   migration/node_modules/.bin/tsx migration/wp-admin-tour.ts                 # full tour
 *   migration/node_modules/.bin/tsx migration/wp-admin-tour.ts --from-export   # no login: schema from wp-export.xml
 */

import { chromium, type Page } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { config as loadEnv } from 'dotenv';
import path from 'node:path';

const MIGRATION_DIR = path.join(process.cwd(), 'migration');
loadEnv({ path: path.join(MIGRATION_DIR, '.env.local') });

const WP_ADMIN_URL = process.env.WP_ADMIN_URL?.replace(/\/$/, '');
const WP_USERNAME = process.env.WP_USERNAME;
const WP_PASSWORD = process.env.WP_PASSWORD;
const HEADLESS = process.env.HEADLESS !== 'false';
const CHECK_ONLY = process.argv.includes('--check');
const FROM_EXPORT = process.argv.includes('--from-export');

if (!FROM_EXPORT && (!WP_ADMIN_URL || !WP_USERNAME || !WP_PASSWORD)) {
  throw new Error('Missing WP_ADMIN_URL / WP_USERNAME / WP_PASSWORD in migration/.env.local');
}

const SITE_URL = (WP_ADMIN_URL ?? '').replace(/\/wp-admin$/, '');

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

type SiteSettings = {
  title: string;
  tagline: string;
  /** Settings → Permalinks, e.g. `/%postname%/`. Empty string = plain `?p=123` links. */
  permalinkStructure: string;
  /** Settings → Reading. `page` = a static page is the homepage. */
  frontPage: { show: 'posts' } | { show: 'page'; pageId: number; postsPageId?: number };
};

type Manifest = {
  generatedAt: string;
  /** Set when the schema was projected from an export file instead of observed in /wp-admin. */
  derivedFrom?: 'export';
  siteUrl: string;
  wpVersion?: string;
  site: SiteSettings;
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

/**
 * Admin screens the tour needs. Each is only in the admin menu when the account can use it,
 * so an Editor login (which can sign in fine) is caught here instead of halfway through the tour.
 */
const REQUIRED_SCREENS = [
  { href: 'plugins.php', needFor: 'plugin detection' },
  { href: 'export.php', needFor: 'the content export' },
  { href: 'options-general.php', needFor: 'site settings' },
];

/** Fail fast unless the account can open every screen the tour needs. `--check` stops after this. */
async function checkAccess(page: Page): Promise<void> {
  const missing = [];
  for (const screen of REQUIRED_SCREENS) {
    if ((await page.locator(`#adminmenu a[href$="${screen.href}"]`).count()) === 0) missing.push(screen);
  }
  if (missing.length) {
    throw new Error(
      `Logged in, but this account can't open ${missing.map((m) => `${m.href} (needed for ${m.needFor})`).join(', ')}. ` +
        'Use an Administrator account for the migration.'
    );
  }
}

async function detectWpVersion(page: Page): Promise<string | undefined> {
  const footer = await page.locator('#footer-upgrade').textContent().catch(() => null);
  return footer?.match(/([\d]+\.[\d.]+)/)?.[1];
}

/** Settings → General / Permalinks / Reading. Read-only: the forms are never submitted. */
async function readSiteSettings(page: Page): Promise<SiteSettings> {
  await page.goto(`${WP_ADMIN_URL}/options-general.php`);
  const title = await page.inputValue('#blogname');
  const tagline = await page.inputValue('#blogdescription');
  await page.goto(`${WP_ADMIN_URL}/options-permalink.php`);
  const permalinkStructure = await page.inputValue('#permalink_structure').catch(() => '');
  await page.goto(`${WP_ADMIN_URL}/options-reading.php`);
  const show = await page.locator('input[name="show_on_front"]:checked').inputValue().catch(() => 'posts');
  if (show !== 'page') return { title, tagline, permalinkStructure, frontPage: { show: 'posts' } };
  const pageId = Number(await page.inputValue('#page_on_front'));
  const postsPageId = Number(await page.inputValue('#page_for_posts').catch(() => '0')) || undefined;
  return { title, tagline, permalinkStructure, frontPage: { show: 'page', pageId, postsPageId } };
}

async function detectPlugins(page: Page): Promise<Manifest['plugins']> {
  await page.goto(`${WP_ADMIN_URL}/plugins.php?plugin_status=active`);
  // A plugin with an update waiting gets a second row (the notice) with the same slug.
  const active = [...new Set(await page.$$eval('tr.active[data-slug]:not(.plugin-update-tr)', (rows) =>
    rows.map((r) => r.getAttribute('data-slug')!).filter(Boolean)
  ))];
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
          // WordPress stores '' for "same tab"; the transformer maps it to `_self`.
          { type: 'string', name: 'target', label: 'Open in', options: [{ value: '_self', label: 'Same tab' }, { value: '_blank', label: 'New tab' }] },
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

async function writeManifest(manifest: Manifest, skipped: string[]): Promise<void> {
  const outPath = path.join(MIGRATION_DIR, 'schema.json');
  await writeFile(outPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`[tour] schema written to ${outPath}`);
  for (const s of manifest.postTypes) {
    for (const m of s.unmapped) console.warn(`[tour]   UNMAPPED on ${s.name}: metabox "${m.title}" (#${m.id})`);
  }
  for (const s of new Set(skipped)) console.warn(`[tour]   SKIPPED field: ${s}`);
}

// ---------------------------------------------------------------------------
// --from-export: no admin login, so project the schema from stored values
// ---------------------------------------------------------------------------

// Post types an export carries that aren't editorial content.
const EXPORT_SKIP_TYPES = new Set([
  ...INTERNAL_POST_TYPES, 'acf-field', 'nav_menu_item', 'revision', 'custom_css', 'customize_changeset', 'oembed_cache', 'user_request', 'wp_global_styles',
]);

/** `event_type` → `Event Types`. The export has no labels, so build one from the slug. */
const labelFor = (slug: string) => {
  const known: Record<string, string> = { post: 'Posts', page: 'Pages', category: 'Categories', post_tag: 'Tags' };
  if (known[slug]) return known[slug];
  const words = slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return /s$/.test(words) ? words : words.replace(/y$/, 'ie') + 's';
};

/** Settings → Permalinks isn't exported, so read it off a published post's URL. */
function guessPermalinkStructure(postLinks: string[], home: string): string {
  const link = postLinks[0];
  if (!link) return '/%postname%/';
  if (/[?&]p=\d+/.test(link)) return '';
  const rel = link.replace(home, '');
  if (/^\/\d{4}\/\d{2}\/\d{2}\/[^/]+\/?$/.test(rel)) return '/%year%/%monthnum%/%day%/%postname%/';
  if (/^\/\d{4}\/\d{2}\/[^/]+\/?$/.test(rel)) return '/%year%/%monthnum%/%postname%/';
  return '/%postname%/';
}

async function schemaFromExport(): Promise<void> {
  const { XMLParser } = await import('fast-xml-parser');
  const xml = await readFile(path.join(MIGRATION_DIR, 'wp-export.xml'), 'utf8').catch(() => {
    throw new Error('migration/wp-export.xml not found. Save the Tools → Export → All content file there first.');
  });
  const asArray = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
  const text = (x: unknown): string => (x === undefined || x === null ? '' : typeof x === 'object' ? String((x as Record<string, unknown>)['#text'] ?? '') : String(x));
  const channel = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, trimValues: false }).parse(xml).rss.channel;

  // ACF → Tools → Export As JSON is an array; a theme's acf-json/ file is one group.
  const acfJson = await readFile(path.join(MIGRATION_DIR, 'acf-field-groups.json'), 'utf8').then(JSON.parse).catch(() => []);
  const acfGroups = (asArray(acfJson) as AcfFieldGroup[]).filter((g) => g.active !== false && g.active !== 0);

  const items = asArray(channel.item as Record<string, unknown>[]).map((it) => ({
    id: Number(text(it['wp:post_id'])),
    type: text(it['wp:post_type']),
    status: text(it['wp:status']),
    link: text(it.link),
    content: text(it['content:encoded']),
    excerpt: text(it['excerpt:encoded']),
    taxonomies: asArray(it.category as Record<string, string>[]).map((c) => c['@_domain']),
    meta: new Map(asArray(it['wp:postmeta'] as Record<string, unknown>[]).map((m) => [text(m['wp:meta_key']), text(m['wp:meta_value'])])),
  }));
  const content = items.filter((i) => !EXPORT_SKIP_TYPES.has(i.type) && !['auto-draft', 'inherit', 'trash'].includes(i.status));
  const metaKeys = (i: (typeof items)[number]) => [...i.meta.keys()];
  const hasMeta = (re: RegExp) => content.some((i) => metaKeys(i).some((k) => re.test(k)));

  const home = (text(channel.link) || text(channel['wp:base_site_url'])).replace(/\/$/, '');
  const frontPage = content.find((i) => i.type === 'page' && i.status === 'publish' && i.link.replace(/\/$/, '') === home);
  const site: SiteSettings = {
    title: text(channel.title),
    tagline: text(channel.description),
    permalinkStructure: guessPermalinkStructure(content.filter((i) => i.type === 'post' && i.status === 'publish').map((i) => i.link), home),
    frontPage: frontPage ? { show: 'page', pageId: frontPage.id } : { show: 'posts' },
  };
  // Settings → Reading is public in the REST API index on current WordPress. Use it when the site answers.
  const index = await fetch(`${home}/wp-json/`, { signal: AbortSignal.timeout(10_000) }).then((r) => (r.ok ? r.json() : undefined)).catch(() => undefined);
  if (index?.show_on_front === 'page' && index.page_on_front) {
    site.frontPage = { show: 'page', pageId: Number(index.page_on_front), postsPageId: Number(index.page_for_posts) || undefined };
  } else if (index?.show_on_front === 'posts') {
    site.frontPage = { show: 'posts' };
  }
  // ACF saves `_<field name>` = `field_…` next to each value.
  const acfNamesIn = (i: (typeof items)[number]) => [...i.meta].filter(([k, v]) => k.startsWith('_') && v.startsWith('field_')).map(([k]) => k.slice(1));
  const plugins: Manifest['plugins'] = {
    acf: acfGroups.length > 0 || content.some((i) => acfNamesIn(i).length > 0),
    yoast: hasMeta(/^_yoast_wpseo_/),
    rankMath: hasMeta(/^rank_math_/),
    active: [],
  };
  for (const g of acfGroups) {
    if (acfGroupPostTypes(g).size === 0) console.warn(`[tour]   ACF group "${g.title}" isn't tied to a post type (template or options-page rule?). Add it to the right post type in schema.json by hand.`);
  }

  const termParents = new Map<string, boolean>(); // taxonomy → any term has a parent
  for (const t of asArray(channel['wp:term'] as Record<string, unknown>[])) {
    const tax = text(t['wp:term_taxonomy']);
    termParents.set(tax, termParents.get(tax) || !!text(t['wp:term_parent']));
  }

  const postTypeNames = [...new Set(content.map((i) => i.type))];
  const skipped: string[] = [];
  const ctx = { acfGroups, plugins, postTypeNames, skipped };
  const schemas: PostTypeSchema[] = [];
  const taxonomies = new Map<string, Taxonomy>();
  for (const name of postTypeNames) {
    const own = content.filter((i) => i.type === name);
    const taxNames = [...new Set(own.flatMap((i) => i.taxonomies))].filter((t) => t && !INTERNAL_TAXONOMIES.has(t));
    const taxList = taxNames.map((t) => ({ name: t, label: labelFor(t), hierarchical: t === 'category' || (t !== 'post_tag' && !!termParents.get(t)) }));
    // Stand-ins for the metaboxes the tour would have seen, so buildPostTypeSchema treats both modes alike.
    const metaboxes: ScreenInfo['metaboxes'] = [];
    if (own.some((i) => metaKeys(i).some((k) => k.startsWith('_yoast_wpseo_')))) metaboxes.push({ id: 'wpseo_meta', title: 'Yoast SEO' });
    if (own.some((i) => metaKeys(i).some((k) => k.startsWith('rank_math_')))) metaboxes.push({ id: 'rank_math_metabox', title: 'Rank Math SEO' });
    // Without the field group definitions, ACF values can't be typed.
    const acfNames = [...new Set(own.flatMap(acfNamesIn))];
    if (acfNames.length && !acfGroups.some((g) => acfGroupPostTypes(g).has(name))) {
      metaboxes.push({ id: 'acf', title: `ACF fields without definitions (${acfNames.join(', ')}). Save ACF → Tools → Export As JSON, or the theme's acf-json/ files, as migration/acf-field-groups.json and run again` });
    }
    // Plain custom fields (no leading underscore, not ACF): WordPress's own Custom Fields box, or a plugin's.
    // `footnotes` is the block editor's footnotes block, already part of the body.
    for (const key of new Set(own.flatMap(metaKeys))) {
      if (key === 'footnotes' || key.startsWith('_') || key.startsWith('rank_math_')) continue;
      if (!acfNames.includes(key) && !acfNames.some((a) => key.startsWith(`${a}_`))) {
        metaboxes.push({ id: `custom-field-${key}`, title: `Custom field "${key}"` });
      }
    }
    const screen: ScreenInfo = {
      editor: own.some((i) => i.content.includes('<!-- wp:')) ? 'block' : 'classic',
      supports: {
        title: true,
        editor: name === 'post' || name === 'page' || own.some((i) => i.content.trim()),
        excerpt: name === 'post' || own.some((i) => i.excerpt.trim()),
        thumbnail: own.some((i) => i.meta.has('_thumbnail_id')),
      },
      taxonomies: taxList,
      metaboxes,
    };
    schemas.push(buildPostTypeSchema({ name, label: labelFor(name) }, screen, ctx));
    for (const t of taxList) {
      const existing = taxonomies.get(t.name) ?? { ...t, postTypes: [] };
      existing.postTypes.push(name);
      taxonomies.set(t.name, existing);
    }
  }

  console.log(`[tour] read the export: "${site.title}", ${postTypeNames.length} post types (${postTypeNames.join(', ')}), ${acfGroups.length} ACF field groups`);
  console.log(`[tour]   permalinks guessed as ${site.permalinkStructure || '(plain)'}, front page: ${site.frontPage.show}`);
  if (site.frontPage.show === 'page' && !site.frontPage.postsPageId) {
    console.warn('[tour]   couldn\'t tell which page lists the posts. Set site.frontPage.postsPageId in schema.json if there is one.');
  }
  await writeManifest(
    { generatedAt: new Date().toISOString(), derivedFrom: 'export', siteUrl: home, wpVersion: text(channel.generator).match(/v=([\d.]+)/)?.[1], site, postTypes: schemas, taxonomies: [...taxonomies.values()], plugins },
    skipped
  );
}

async function main(): Promise<void> {
  if (FROM_EXPORT) return schemaFromExport();

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  console.log('[tour] logging in…');
  await login(page);
  const wpVersion = await detectWpVersion(page);
  console.log(`[tour]   WordPress ${wpVersion ?? '(version hidden)'}`);

  await checkAccess(page);
  if (CHECK_ONLY) {
    await browser.close();
    console.log('[tour] check passed: login works and the account is an administrator. Nothing was written.');
    return;
  }

  console.log('[tour] reading site settings…');
  const site = await readSiteSettings(page);
  console.log(`[tour]   "${site.title}", permalinks ${site.permalinkStructure || '(plain)'}, front page: ${site.frontPage.show}`);

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

  await writeManifest(
    { generatedAt: new Date().toISOString(), siteUrl: SITE_URL, wpVersion, site, postTypes: schemas, taxonomies: [...taxonomies.values()], plugins },
    skipped
  );

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
