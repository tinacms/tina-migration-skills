/**
 * Generate TinaCMS collections from the admin tour's migration/schema.json.
 *
 * Writes, relative to the project root (the current directory):
 *   tina/collections/wordpress/<collection>.ts   one per post type and taxonomy
 *   tina/collections/wordpress/index.ts          `wordpressCollections` array
 *   src/lib/wordpress.json                       URL rules the Astro routes use
 *
 * Re-running overwrites these files. Edit the generated collections freely
 * once you're happy with them, and stop re-running the generator.
 *
 * Usage (from the project root):
 *   migration/node_modules/.bin/tsx migration/generate-collections.ts
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

type FieldSource = { kind: string; taxonomy?: string; [k: string]: unknown };
type Field = {
  type: string;
  name: string;
  label: string;
  list?: boolean;
  collections?: string[];
  fields?: Field[];
  ui?: Record<string, unknown> & { templates?: { name: string; label: string; fields: Field[] }[] };
  source?: FieldSource;
  [k: string]: unknown;
};
type PostType = { name: string; label: string; editor: string; fields: Field[] };
type Taxonomy = { name: string; label: string; hierarchical: boolean; postTypes: string[] };
type Manifest = {
  site: { title: string; tagline: string; permalinkStructure: string };
  postTypes: PostType[];
  taxonomies: Taxonomy[];
};

/** URL rule for one collection. `:path` = the file's path inside the collection, without extension. */
export type RouteRule = {
  kind: 'post' | 'page' | 'cpt' | 'taxonomy';
  label: string;
  pattern: string;
  /** For content collections: listing page URL (CPT archive). Posts use the WordPress "posts page". */
  archive?: string;
  /** For taxonomies: which field on each content collection holds this taxonomy's terms. */
  usedBy?: Record<string, string>;
};

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'tina/collections/wordpress');
const toTinaName = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
const taxonomyCollection = (tax: string) => toTinaName(tax === 'post_tag' ? 'tag' : tax);
const pascal = (s: string) => s.split('_').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
const warnings: string[] = [];

/** Turn a WordPress permalink structure into a route pattern for posts. */
function postPattern(structure: string): string {
  if (!structure) {
    warnings.push('Plain permalinks (?p=123) — posts get /:path/ URLs. Add redirects from the old ?p= URLs.');
    return '/:path/';
  }
  const supported = { '%postname%': ':path', '%year%': ':year', '%monthnum%': ':month', '%day%': ':day' } as Record<string, string>;
  const unsupported = structure.match(/%[a-z_]+%/g)?.filter((t) => !supported[t]) ?? [];
  if (unsupported.length || !structure.includes('%postname%')) {
    warnings.push(`Permalink structure ${structure} uses ${unsupported.join(', ') || 'no %postname%'} — posts get /:path/ URLs. Check the URL report from the transform and add redirects.`);
    return '/:path/';
  }
  return structure.replace(/%[a-z_]+%/g, (t) => supported[t]).replace(/\/?$/, '/');
}

/** Strip `source`, move flexible-content templates out of `ui`, and drop references to collections that don't exist. */
function toTinaField(field: Field, collections: Set<string>): Field {
  const { source: _source, ...rest } = field;
  const out: Field = { ...rest };
  if (out.collections) {
    out.collections = out.collections.map(toTinaName);
    const missing = out.collections.filter((c) => !collections.has(c));
    if (missing.length) {
      warnings.push(`Field "${field.label}" references ${missing.join(', ')}, which isn't migrated — kept as a plain string.`);
      delete out.collections;
      out.type = 'string';
    }
  }
  if (out.fields) out.fields = out.fields.map((f) => toTinaField(f, collections));
  if (out.ui?.templates) {
    const { templates, ...ui } = out.ui;
    out.templates = templates.map((t) => ({ ...t, fields: t.fields.map((f) => toTinaField(f, collections)) }));
    out.ui = Object.keys(ui).length ? ui : undefined;
    if (!out.ui) delete out.ui;
  }
  if (out.type === 'rich-text' && out.name === 'body') out.isBody = true;
  // Name list items in the editor instead of Tina's default "<Label> Item".
  if (out.type === 'object' && out.list && out.fields?.length) {
    const isRefList = out.fields.length === 1 && out.fields[0].type === 'reference';
    const firstText = out.fields.find((f) => f.type === 'string' && !f.list);
    if (isRefList || firstText) out.ui = { ...out.ui, itemProps: isRefList ? ITEM_PROPS_REF : `${ITEM_PROPS_FIELD}${firstText!.name}` };
  }
  return out;
}

// Placeholders swapped for real functions when the collection file is written (functions don't survive JSON).
const ITEM_PROPS_REF = '__itemProps_ref__';
const ITEM_PROPS_FIELD = '__itemProps_field__';
const withFunctions = (json: string) =>
  json
    .replaceAll(`"${ITEM_PROPS_REF}"`, "(item) => ({ label: item?.item?.split('/').pop()?.replace(/\\.(mdx|json)$/, '') })")
    .replace(new RegExp(`"${ITEM_PROPS_FIELD}(\\w+)"`, 'g'), '(item) => ({ label: item?.$1 })');

function collectionFile(opts: {
  name: string;
  label: string;
  format: 'mdx' | 'json';
  routerPath?: string;
  fields: Field[];
  note: string;
}): string {
  const router = opts.routerPath
    ? `\n  ui: {\n    router: ({ document }) => \`${opts.routerPath.replace(':path', "${document._sys.breadcrumbs.join('/')}")}\`,\n  },`
    : '';
  return `// Generated from migration/schema.json by generate-collections.ts — ${opts.note}
import type { Collection } from 'tinacms';

const fields: Collection['fields'] = ${withFunctions(JSON.stringify(opts.fields, null, 2))};

export const ${pascal(opts.name)}Collection: Collection = {
  name: '${opts.name}',
  label: ${JSON.stringify(opts.label)},
  path: 'src/content/${opts.name}',
  format: '${opts.format}',${router}
  fields,
};
`;
}

async function main(): Promise<void> {
  const manifest: Manifest = JSON.parse(await readFile(path.join(ROOT, 'migration/schema.json'), 'utf8'));
  const collectionNames = new Set([
    ...manifest.postTypes.map((p) => toTinaName(p.name)),
    ...manifest.taxonomies.map((t) => taxonomyCollection(t.name)),
  ]);
  if (collectionNames.size !== manifest.postTypes.length + manifest.taxonomies.length) {
    throw new Error('Two post types / taxonomies map to the same collection name — rename one in schema.json first.');
  }

  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  const routes: Record<string, RouteRule> = {};
  const exports: string[] = [];

  for (const pt of manifest.postTypes) {
    const name = toTinaName(pt.name);
    const kind = pt.name === 'post' ? 'post' : pt.name === 'page' ? 'page' : 'cpt';
    // WordPress defaults: posts follow Settings → Permalinks, pages sit at the root, CPTs under /<post_type>/.
    const pattern = kind === 'post' ? postPattern(manifest.site.permalinkStructure) : kind === 'page' ? '/:path/' : `/${pt.name}/:path/`;
    routes[name] = { kind, label: pt.label, pattern, ...(kind === 'cpt' ? { archive: `/${pt.name}/` } : {}) };
    const fields = pt.fields.map((f) => toTinaField(f, collectionNames));
    const routerPath = pattern.includes(':year') ? undefined : pattern;
    await writeFile(path.join(OUT_DIR, `${name}.ts`), collectionFile({ name, label: pt.label, format: 'mdx', routerPath, fields, note: `WordPress post type "${pt.name}" (${pt.editor} editor)` }));
    exports.push(name);
  }

  for (const tax of manifest.taxonomies) {
    const name = taxonomyCollection(tax.name);
    const fields: Field[] = [
      { type: 'string', name: 'title', label: 'Name', isTitle: true, required: true },
      { type: 'string', name: 'description', label: 'Description', ui: { component: 'textarea' } },
      ...(tax.hierarchical ? [{ type: 'reference', name: 'parent', label: 'Parent', collections: [name] }] : []),
    ];
    // WordPress default term URLs: /category/<slug>/, /tag/<slug>/, /<taxonomy>/<slug>/
    const base = tax.name === 'post_tag' ? 'tag' : tax.name;
    const usedBy: Record<string, string> = {};
    for (const pt of manifest.postTypes) {
      const field = pt.fields.find((f) => f.source?.kind === 'taxonomy' && f.source.taxonomy === tax.name);
      if (field) usedBy[toTinaName(pt.name)] = field.name;
    }
    routes[name] = { kind: 'taxonomy', label: tax.label, pattern: `/${base}/:path/`, usedBy };
    await writeFile(path.join(OUT_DIR, `${name}.ts`), collectionFile({ name, label: tax.label, format: 'json', routerPath: `/${base}/:path/`, fields, note: `WordPress taxonomy "${tax.name}"` }));
    exports.push(name);
  }

  await writeFile(
    path.join(OUT_DIR, 'index.ts'),
    `// Generated by generate-collections.ts\n${exports.map((n) => `import { ${pascal(n)}Collection } from './${n}';`).join('\n')}\n\nexport const wordpressCollections = [\n${exports.map((n) => `  ${pascal(n)}Collection,`).join('\n')}\n];\n`
  );

  // Keep anything the content transform already wrote (front page, site title).
  const routesPath = path.join(ROOT, 'src/lib/wordpress.json');
  const existing = await readFile(routesPath, 'utf8').then(JSON.parse).catch(() => ({}));
  await mkdir(path.dirname(routesPath), { recursive: true });
  await writeFile(routesPath, JSON.stringify({ ...existing, routes }, null, 2) + '\n');

  console.log(`[generate] ${exports.length} collections written to tina/collections/wordpress/: ${exports.join(', ')}`);
  console.log('[generate] URL rules written to src/lib/wordpress.json');
  for (const w of warnings) console.warn(`[generate]   WARNING: ${w}`);
}

main().catch((err) => {
  console.error('[generate] fatal:', err);
  process.exit(1);
});
