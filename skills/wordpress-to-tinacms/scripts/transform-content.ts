/**
 * Transform migration/wp-export.xml into TinaCMS content, using the field
 * sources the admin tour recorded in migration/schema.json.
 *
 * Writes, relative to the project root (the current directory):
 *   src/content/<collection>/<slug>.mdx       posts, pages (nested by parent), CPTs
 *   src/content/<taxonomy>/<slug>.json        taxonomy terms
 *   public/uploads/...                        media, same paths as wp-content/uploads
 *   src/content/config/config.json            site title, tagline and nav (merged)
 *   src/lib/wordpress.json                    front page + posts page (merged)
 *   migration/transform-report.json           counts, skips and URL mismatches
 *
 * Only published items are migrated unless you pass --drafts.
 *
 * Usage (from the project root, after generate-collections.ts):
 *   migration/node_modules/.bin/tsx migration/transform-content.ts
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import TurndownService from 'turndown';
import { stringify as toYaml } from 'yaml';

const ROOT = process.cwd();
const INCLUDE_DRAFTS = process.argv.includes('--drafts');

type FieldSource =
  | { kind: 'core'; wpField: string }
  | { kind: 'taxonomy'; taxonomy: string }
  | { kind: 'acf'; key: string; metaKey: string; acfType: string }
  | { kind: 'acf-group'; key: string }
  | { kind: 'seo'; plugin: 'yoast' | 'rank-math'; metaKey?: string };
type Field = { type: string; name: string; label: string; list?: boolean; fields?: Field[]; ui?: { templates?: { name: string; fields: Field[] }[] }; source?: FieldSource };
type Manifest = {
  siteUrl: string;
  site: { title: string; tagline: string; frontPage: { show: 'posts' } | { show: 'page'; pageId: number; postsPageId?: number } };
  postTypes: { name: string; fields: Field[] }[];
  taxonomies: { name: string; hierarchical: boolean }[];
};
type RouteRule = { kind: string; pattern: string };

type Item = {
  id: number;
  type: string;
  status: string;
  slug: string;
  title: string;
  link: string;
  date: string;
  parent: number;
  menuOrder: number;
  content: string;
  excerpt: string;
  terms: { domain: string; slug: string }[];
  meta: Map<string, string>;
  attachmentUrl?: string;
};

const toTinaName = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
const taxonomyCollection = (tax: string) => toTinaName(tax === 'post_tag' ? 'tag' : tax);
const report = {
  migrated: {} as Record<string, number>,
  skipped: [] as string[],
  media: 0,
  urlMismatches: [] as { old: string; new: string }[],
  warnings: [] as string[],
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** PHP `serialize()` — ACF stores arrays (checkbox, relationship, link, gallery) this way in postmeta. */
function phpUnserialize(input: string): unknown {
  const buf = Buffer.from(input, 'utf8');
  let i = 0;
  const until = (ch: string) => {
    const j = buf.indexOf(ch, i);
    if (j < 0) throw new Error('bad serialized data');
    const s = buf.toString('utf8', i, j);
    i = j + 1;
    return s;
  };
  const parse = (): unknown => {
    const type = String.fromCharCode(buf[i]);
    i += 2;
    switch (type) {
      case 'N': return null;
      case 'b': return until(';') === '1';
      case 'i': return parseInt(until(';'), 10);
      case 'd': return parseFloat(until(';'));
      case 's': {
        const len = parseInt(until(':'), 10);
        const s = buf.toString('utf8', i + 1, i + 1 + len);
        i += len + 3; // opening quote, bytes, closing quote + ;
        return s;
      }
      case 'a': {
        const n = parseInt(until(':'), 10);
        i += 1; // {
        const entries: [unknown, unknown][] = [];
        for (let k = 0; k < n; k++) entries.push([parse(), parse()]);
        i += 1; // }
        const isList = entries.every(([key], idx) => key === idx);
        return isList ? entries.map(([, v]) => v) : Object.fromEntries(entries.map(([k, v]) => [String(k), v]));
      }
      default:
        throw new Error(`unsupported serialized type ${type}`);
    }
  };
  return parse();
}

function maybeUnserialize(value: string): unknown {
  if (!/^(a|s|i|b|d):\d*/.test(value) && value !== 'N;') return value;
  try {
    return phpUnserialize(value);
  } catch {
    return value;
  }
}

const asArray = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
const text = (x: unknown): string => (x === undefined || x === null ? '' : typeof x === 'object' ? String((x as Record<string, unknown>)['#text'] ?? '') : String(x));

function parseExport(xml: string) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', cdataPropName: false, parseTagValue: false, trimValues: false });
  const channel = parser.parse(xml).rss.channel;
  const terms: { id: number; taxonomy: string; slug: string; name: string; parent: string; description: string }[] = [];
  for (const c of asArray(channel['wp:category'])) {
    terms.push({ id: Number(text(c['wp:term_id'])), taxonomy: 'category', slug: text(c['wp:category_nicename']), name: text(c['wp:cat_name']), parent: text(c['wp:category_parent']), description: text(c['wp:category_description']) });
  }
  for (const t of asArray(channel['wp:tag'])) {
    terms.push({ id: Number(text(t['wp:term_id'])), taxonomy: 'post_tag', slug: text(t['wp:tag_slug']), name: text(t['wp:tag_name']), parent: '', description: text(t['wp:tag_description']) });
  }
  for (const t of asArray(channel['wp:term'])) {
    terms.push({ id: Number(text(t['wp:term_id'])), taxonomy: text(t['wp:term_taxonomy']), slug: text(t['wp:term_slug']), name: text(t['wp:term_name']), parent: text(t['wp:term_parent']), description: text(t['wp:term_description']) });
  }
  const items: Item[] = asArray(channel.item).map((it: Record<string, unknown>) => ({
    id: Number(text(it['wp:post_id'])),
    type: text(it['wp:post_type']),
    status: text(it['wp:status']),
    slug: text(it['wp:post_name']),
    title: text(it.title),
    link: text(it.link),
    date: text(it['wp:post_date_gmt']) || text(it['wp:post_date']),
    parent: Number(text(it['wp:post_parent'])) || 0,
    menuOrder: Number(text(it['wp:menu_order'])) || 0,
    content: text(it['content:encoded']),
    excerpt: text(it['excerpt:encoded']),
    terms: asArray(it.category as Record<string, string>[]).map((c) => ({ domain: c['@_domain'], slug: c['@_nicename'] })),
    meta: new Map(asArray(it['wp:postmeta'] as Record<string, unknown>[]).map((m) => [text(m['wp:meta_key']), text(m['wp:meta_value'])])),
    attachmentUrl: text(it['wp:attachment_url']) || undefined,
  }));
  return { baseUrl: text(channel['wp:base_site_url']) || text(channel.link), siteTitle: text(channel.title), terms, items };
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '_' });
// MDX treats { } and < as syntax — escape them in text so WordPress prose can't break the parser.
const baseEscape = turndown.escape.bind(turndown);
turndown.escape = (s: string) => baseEscape(s).replace(/[{}<>]/g, (c) => `\\${c}`);

function toIsoDate(value: string): string | undefined {
  if (!value) return undefined;
  const v = /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : value;
  const d = new Date(v.includes('T') ? v : `${v.replace(' ', 'T')}${v.length > 10 ? 'Z' : 'T00:00:00Z'}`);
  return Number.isNaN(d.valueOf()) ? undefined : d.toISOString();
}

function transform(manifest: Manifest, data: ReturnType<typeof parseExport>, routes: Record<string, RouteRule>) {
  const base = data.baseUrl.replace(/\/$/, '');
  const byId = new Map(data.items.map((i) => [i.id, i]));
  const termById = new Map(data.terms.map((t) => [t.id, t]));
  const postTypeNames = new Set(manifest.postTypes.map((p) => p.name));
  const migratable = (i: Item) => postTypeNames.has(i.type) && i.slug && (i.status === 'publish' || (INCLUDE_DRAFTS && i.status === 'draft'));

  // Media: every attachment plus any other wp-content/uploads URL the content points at.
  const media = new Map<string, string>(); // remote URL → local /uploads/... path
  const localUpload = (url: string) => {
    const m = url.match(/\/wp-content\/uploads\/(.+)$/);
    if (!m) return undefined;
    const local = `/uploads/${m[1].split('?')[0]}`;
    media.set(url, local);
    return local;
  };
  const attachmentPath = (id: unknown) => {
    const att = byId.get(Number(id));
    return att?.attachmentUrl ? localUpload(att.attachmentUrl) : undefined;
  };
  const rewriteUrls = (s: string) =>
    s
      .replace(new RegExp(`${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/wp-content/uploads/[^"'\\s)]+`, 'g'), (u) => localUpload(u) ?? u)
      .replace(new RegExp(`${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=/)`, 'g'), '');
  const toMarkdown = (html: string) => turndown.turndown(rewriteUrls(html.replace(/<!--[\s\S]*?-->/g, ''))).trim();

  // Where each document lives. Pages nest under their parent page, like their WordPress URLs.
  const docPath = (item: Item): string => {
    if (item.type === 'page' && item.parent && byId.get(item.parent)?.type === 'page') return `${docPath(byId.get(item.parent)!)}/${item.slug}`;
    return item.slug;
  };
  const docFile = (item: Item) => `src/content/${toTinaName(item.type)}/${docPath(item)}.mdx`;
  const termFile = (t: { taxonomy: string; slug: string }) => `src/content/${taxonomyCollection(t.taxonomy)}/${t.slug}.json`;
  const reference = (id: unknown) => {
    const target = byId.get(Number(id));
    return target && migratable(target) ? docFile(target) : undefined;
  };
  const listOf = (refs: (string | undefined)[]) => {
    const items = refs.filter((r): r is string => !!r).map((r) => ({ item: r }));
    return items.length ? items : undefined;
  };

  function acfValue(field: Field, src: Extract<FieldSource, { kind: 'acf' }>, meta: Map<string, string>, prefix: string): unknown {
    const key = prefix + src.metaKey;
    const raw = meta.get(key);
    const sub = (f: Field, p: string) => (f.source?.kind === 'acf' ? acfValue(f, f.source, meta, p) : undefined);
    const objectOf = (fields: Field[] = [], p: string) => {
      const out: Record<string, unknown> = {};
      for (const f of fields) {
        const v = sub(f, p);
        if (v !== undefined) out[f.name] = v;
      }
      return Object.keys(out).length ? out : undefined;
    };
    switch (src.acfType) {
      case 'group':
        return objectOf(field.fields, `${key}_`);
      case 'repeater': {
        const rows = Array.from({ length: Number(raw) || 0 }, (_, n) => objectOf(field.fields, `${key}_${n}_`)).filter(Boolean);
        return rows.length ? rows : undefined;
      }
      case 'flexible_content': {
        const layouts = asArray(maybeUnserialize(raw ?? '') as string[]);
        const rows = layouts.map((layout, n) => {
          const tpl = field.ui?.templates?.find((t) => t.name === toTinaName(layout));
          return tpl ? { _template: tpl.name, ...objectOf(tpl.fields, `${key}_${n}_`) } : undefined;
        }).filter(Boolean);
        return rows.length ? rows : undefined;
      }
    }
    if (src.acfType === 'true_false') return raw === undefined ? undefined : raw === '1'; // ACF saves an unticked box as ''
    if (raw === undefined || raw === '') return undefined;
    const value = maybeUnserialize(raw);
    switch (src.acfType) {
      case 'number':
      case 'range':
        return Number(value);
      case 'date_picker':
      case 'date_time_picker':
        return toIsoDate(String(value));
      case 'image':
      case 'file':
        return attachmentPath(value) ?? (typeof value === 'string' && value.startsWith('http') ? rewriteUrls(value) : undefined);
      case 'gallery':
        return asArray(value as unknown[]).map(attachmentPath).filter(Boolean);
      case 'wysiwyg':
        return toMarkdown(String(value));
      case 'checkbox':
        return asArray(value as string[]);
      case 'select':
        return field.list ? asArray(value as string[]) : value;
      case 'link': {
        const link = value as { title?: string; url?: string; target?: string };
        if (typeof link !== 'object' || !link?.url) return undefined;
        return { title: link.title || undefined, url: rewriteUrls(link.url), target: link.target || '_self' };
      }
      case 'google_map': {
        const map = value as { address?: string; lat?: string; lng?: string };
        return typeof map === 'object' ? { address: map.address, lat: Number(map.lat), lng: Number(map.lng) } : undefined;
      }
      case 'url':
        return rewriteUrls(String(value));
      case 'post_object':
      case 'page_link':
      case 'relationship':
        return field.list || field.type === 'object' ? listOf(asArray(value as unknown[]).map(reference)) : reference(value);
      case 'taxonomy': {
        const ids = asArray(value as unknown[]);
        const files = ids.map((id) => termById.get(Number(id))).filter((t): t is NonNullable<typeof t> => !!t).map(termFile);
        return field.type === 'object' ? listOf(files) : files[0];
      }
      default:
        return value;
    }
  }

  function seoValue(field: Field, item: Item, siteTitle: string) {
    const out: Record<string, unknown> = {};
    for (const f of field.fields ?? []) {
      if (f.source?.kind !== 'seo' || !f.source.metaKey) continue;
      const raw = item.meta.get(f.source.metaKey);
      if (!raw) continue;
      if (f.name === 'noindex') {
        const v = maybeUnserialize(raw);
        out.noindex = Array.isArray(v) ? v.includes('noindex') : raw === '1';
      } else if (f.name === 'og_image') {
        out.og_image = /^\d+$/.test(raw) ? attachmentPath(raw) : rewriteUrls(raw);
      } else if (f.name === 'title' || f.name === 'description') {
        // Yoast / Rank Math template variables (%%title%%, %sitename%…). Resolve the common ones, drop the rest.
        const resolved = raw
          .replace(/%%?title%%?/g, item.title)
          .replace(/%%?sitename%%?/g, siteTitle)
          .replace(/%%?sep%%?/g, '-')
          .replace(/%%?excerpt%%?/g, item.excerpt)
          .replace(/%%?[a-z_]+%%?/g, '')
          .replace(/\s{2,}/g, ' ')
          .trim();
        if (resolved !== raw) report.warnings.push(`${item.type}/${item.slug}: SEO ${f.name} had template variables — resolved to "${resolved}"`);
        if (resolved) out[f.name] = resolved;
      } else {
        out[f.name] = rewriteUrls(raw);
      }
    }
    return Object.keys(out).length ? out : undefined;
  }

  function frontmatter(item: Item, fields: Field[]) {
    const fm: Record<string, unknown> = {};
    let body = '';
    for (const field of fields) {
      const src = field.source;
      let value: unknown;
      if (src?.kind === 'core') {
        if (src.wpField === 'post_content') {
          body = toMarkdown(item.content);
          continue;
        }
        value =
          src.wpField === 'post_title' ? item.title :
          src.wpField === 'post_date' ? toIsoDate(item.date) :
          src.wpField === 'post_excerpt' ? item.excerpt || undefined :
          src.wpField === '_thumbnail_id' ? attachmentPath(item.meta.get('_thumbnail_id')) :
          undefined;
      } else if (src?.kind === 'taxonomy') {
        value = listOf(item.terms.filter((t) => t.domain === src.taxonomy).map((t) => termFile({ taxonomy: src.taxonomy, slug: t.slug })));
      } else if (src?.kind === 'acf-group') {
        const group: Record<string, unknown> = {};
        for (const f of field.fields ?? []) {
          const v = f.source?.kind === 'acf' ? acfValue(f, f.source, item.meta, '') : undefined;
          if (v !== undefined) group[f.name] = v;
        }
        value = Object.keys(group).length ? group : undefined;
      } else if (src?.kind === 'seo') {
        value = seoValue(field, item, data.siteTitle);
      }
      if (value !== undefined && value !== '') fm[field.name] = value;
    }
    return { fm, body };
  }

  // URL each document gets on the new site, to compare with its WordPress permalink.
  const newUrl = (item: Item) => {
    const rule = routes[toTinaName(item.type)];
    const d = new Date(toIsoDate(item.date) ?? 0);
    const front = manifest.site.frontPage;
    if (front.show === 'page' && front.pageId === item.id) return '/';
    return (rule?.pattern ?? '/:path/')
      .replace(':path', docPath(item))
      .replace(':year', String(d.getUTCFullYear()))
      .replace(':month', String(d.getUTCMonth() + 1).padStart(2, '0'))
      .replace(':day', String(d.getUTCDate()).padStart(2, '0'));
  };

  const files = new Map<string, string>();
  for (const item of data.items) {
    if (!postTypeNames.has(item.type)) continue;
    if (!migratable(item)) {
      if (item.status !== 'auto-draft' && item.status !== 'inherit') report.skipped.push(`${item.type}/${item.slug || item.id} (${item.status})`);
      continue;
    }
    const pt = manifest.postTypes.find((p) => p.name === item.type)!;
    const { fm, body } = frontmatter(item, pt.fields);
    files.set(docFile(item), `---\n${toYaml(fm, { lineWidth: 0 })}---\n\n${body}\n`);
    report.migrated[item.type] = (report.migrated[item.type] ?? 0) + 1;
    const oldPath = item.link ? new URL(item.link).pathname : '';
    const nextPath = newUrl(item);
    if (oldPath && oldPath !== nextPath) report.urlMismatches.push({ old: oldPath, new: nextPath });
  }

  const migratedTaxonomies = new Set(manifest.taxonomies.map((t) => t.name));
  for (const t of data.terms) {
    if (!migratedTaxonomies.has(t.taxonomy)) continue;
    const parent = data.terms.find((p) => p.taxonomy === t.taxonomy && (p.slug === t.parent || String(p.id) === t.parent));
    files.set(termFile(t), JSON.stringify({ title: t.name, ...(t.description ? { description: t.description } : {}), ...(parent ? { parent: termFile(parent) } : {}) }, null, 2) + '\n');
    report.migrated[t.taxonomy] = (report.migrated[t.taxonomy] ?? 0) + 1;
  }

  // Nav: the first WordPress menu, in order. Fall back to Home + top-level pages.
  const menuItems = data.items.filter((i) => i.type === 'nav_menu_item' && i.status === 'publish');
  const firstMenu = menuItems[0]?.terms.find((t) => t.domain === 'nav_menu')?.slug;
  const nav = menuItems
    .filter((i) => i.terms.some((t) => t.domain === 'nav_menu' && t.slug === firstMenu) && i.meta.get('_menu_item_menu_item_parent') === '0')
    .sort((a, b) => a.menuOrder - b.menuOrder)
    .map((i) => {
      const target = byId.get(Number(i.meta.get('_menu_item_object_id')));
      if (i.meta.get('_menu_item_type') === 'post_type' && target) return { title: i.title || target.title, link: newUrl(target) };
      return { title: i.title, link: rewriteUrls(i.meta.get('_menu_item_url') ?? '/') || '/' };
    });
  if (!nav.length) {
    nav.push({ title: 'Home', link: '/' });
    for (const p of data.items.filter((i) => i.type === 'page' && !i.parent && migratable(i))) nav.push({ title: p.title, link: newUrl(p) });
  }

  const front = manifest.site.frontPage;
  const pageRef = (id?: number) => {
    const p = id ? byId.get(id) : undefined;
    return p && migratable(p) ? { collection: toTinaName(p.type), path: docPath(p) } : undefined;
  };
  return {
    files,
    media,
    nav,
    frontPage: front.show === 'page' ? pageRef(front.pageId) : undefined,
    postsPage: front.show === 'page' ? pageRef(front.postsPageId) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function writeAt(rel: string, content: string | Buffer) {
  const abs = path.join(ROOT, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content);
}

async function main(): Promise<void> {
  const manifest: Manifest = JSON.parse(await readFile(path.join(ROOT, 'migration/schema.json'), 'utf8'));
  const routesPath = path.join(ROOT, 'src/lib/wordpress.json');
  const wordpressJson = await readFile(routesPath, 'utf8').then(JSON.parse).catch(() => {
    throw new Error('src/lib/wordpress.json not found — run generate-collections.ts first.');
  });
  const data = parseExport(await readFile(path.join(ROOT, 'migration/wp-export.xml'), 'utf8'));
  const result = transform(manifest, data, wordpressJson.routes);

  for (const [rel, content] of result.files) await writeAt(rel, content);

  for (const [url, local] of result.media) {
    const res = await fetch(url);
    if (!res.ok) {
      report.warnings.push(`Media download failed (${res.status}): ${url}`);
      continue;
    }
    await writeAt(path.join('public', local), Buffer.from(await res.arrayBuffer()));
    report.media++;
  }

  // Merge site identity + nav into the starter's global config, keeping its other settings.
  const configPath = 'src/content/config/config.json';
  const config = await readFile(path.join(ROOT, configPath), 'utf8').then(JSON.parse).catch(() => ({}));
  config.seo = { ...config.seo, title: manifest.site.title, description: manifest.site.tagline || manifest.site.title, siteOwner: manifest.site.title };
  delete config.seo.logo; // the starter's llama logo isn't the client's
  config.nav = result.nav;
  config.contactLinks = [];
  await writeAt(configPath, JSON.stringify(config, null, 2) + '\n');

  // WordPress redirects the front page's own slug to `/`. The starter ships `redirects: { '/home': '/' }`; point it at the real slug.
  if (result.frontPage) {
    const astroConfigPath = path.join(ROOT, 'astro.config.mjs');
    const astroConfig = await readFile(astroConfigPath, 'utf8').catch(() => '');
    const patched = astroConfig.replace(/redirects:\s*\{\s*'\/[^']*':\s*'\/'\s*\}/, `redirects: { '/${result.frontPage.path}': '/' }`);
    if (patched !== astroConfig) await writeFile(astroConfigPath, patched);
    else if (!astroConfig.includes(`'/${result.frontPage.path}': '/'`)) report.warnings.push(`Add redirects: { '/${result.frontPage.path}': '/' } to astro.config.mjs`);
  }

  await writeAt('src/lib/wordpress.json', JSON.stringify({ ...wordpressJson, site: { title: manifest.site.title, tagline: manifest.site.tagline }, frontPage: result.frontPage ?? null, postsPage: result.postsPage ?? null }, null, 2) + '\n');
  await writeAt('migration/transform-report.json', JSON.stringify(report, null, 2) + '\n');

  console.log(`[transform] migrated: ${Object.entries(report.migrated).map(([k, v]) => `${v} ${k}`).join(', ')}`);
  console.log(`[transform] media: ${report.media} files → public/uploads/`);
  if (report.skipped.length) console.log(`[transform] skipped: ${report.skipped.join(', ')}`);
  for (const m of report.urlMismatches) console.warn(`[transform]   URL CHANGED: ${m.old} → ${m.new} (add a redirect)`);
  for (const w of report.warnings) console.warn(`[transform]   WARNING: ${w}`);
  console.log('[transform] report written to migration/transform-report.json');
}

main().catch((err) => {
  console.error('[transform] fatal:', err);
  process.exit(1);
});
