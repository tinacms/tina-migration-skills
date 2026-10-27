/**
 * Generic loader for the collections generated from WordPress.
 *
 * Every generated collection is read through Tina's generic `collection`
 * GraphQL query, so new post types need no code here — only a URL rule in
 * `wordpress.json` (written by generate-collections.ts). Replace these
 * generic pages with real templates as the site's design takes shape.
 */
import type { Collection, TinaField } from 'tinacms';
import client from '../../tina/__generated__/client';
import { wordpressCollections } from '../../tina/collections/wordpress';
import wordpress from './wordpress.json';

type RouteRule = { kind: 'post' | 'page' | 'cpt' | 'taxonomy'; label: string; pattern: string; archive?: string; usedBy?: Record<string, string> };
type PageRef = { collection: string; path: string } | null;
const config = wordpress as {
  routes: Record<string, RouteRule>;
  site?: { title: string; tagline: string };
  frontPage?: PageRef;
  postsPage?: PageRef;
};

export type Doc = {
  collection: string;
  /** Path inside the collection without extension, e.g. `about/team`. */
  path: string;
  /** Repo-relative file, the value reference fields store. */
  file: string;
  url: string;
  title: string;
  values: Record<string, any>;
};

export type Listing = { title: string; docs: Doc[] };
export type Route = { url: string; doc?: Doc; listing?: Listing };

export const site = config.site ?? { title: '', tagline: '' };
export const collectionsByName = new Map<string, Collection>(wordpressCollections.map((c) => [c.name, c]));
export const fieldsOf = (collection: string) => (collectionsByName.get(collection)?.fields ?? []) as TinaField[];

const QUERY = `query ($collection: String, $after: String) {
  collection(collection: $collection) {
    documents(first: 50, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges { node { ... on Document { _sys { relativePath breadcrumbs } _values } } }
    }
  }
}`;

async function loadCollection(name: string): Promise<{ path: string; relativePath: string; values: Record<string, any> }[]> {
  const out = [];
  let after: string | undefined;
  do {
    const res = await client.request<{ collection: { documents: any } }>({ query: QUERY, variables: { collection: name, after } }, {});
    const docs = res.data.collection.documents;
    for (const edge of docs.edges) {
      out.push({ path: edge.node._sys.breadcrumbs.join('/'), relativePath: edge.node._sys.relativePath, values: edge.node._values });
    }
    after = docs.pageInfo.hasNextPage ? docs.pageInfo.endCursor : undefined;
  } while (after);
  return out;
}

function urlFor(rule: RouteRule, path: string, values: Record<string, any>): string {
  const d = values.date ? new Date(values.date) : new Date(0);
  return rule.pattern
    .replace(':path', path)
    .replace(':year', String(d.getUTCFullYear()))
    .replace(':month', String(d.getUTCMonth() + 1).padStart(2, '0'))
    .replace(':day', String(d.getUTCDate()).padStart(2, '0'));
}

const byDateDesc = (a: Doc, b: Doc) => new Date(b.values.date ?? 0).valueOf() - new Date(a.values.date ?? 0).valueOf();

async function build(): Promise<{ routes: Route[]; byFile: Map<string, Doc> }> {
  const docs: Doc[] = [];
  for (const [name, rule] of Object.entries(config.routes)) {
    const folder = collectionsByName.get(name)?.path ?? `src/content/${name}`;
    for (const d of await loadCollection(name)) {
      docs.push({
        collection: name,
        path: d.path,
        file: `${folder}/${d.relativePath}`,
        url: urlFor(rule, d.path, d.values),
        title: d.values.title ?? d.path,
        values: d.values,
      });
    }
  }
  const byFile = new Map(docs.map((d) => [d.file, d]));
  const isRef = (ref?: PageRef | null) => (d: Doc) => !!ref && d.collection === ref.collection && d.path === ref.path;
  const front = docs.find(isRef(config.frontPage));
  const postsPage = docs.find(isRef(config.postsPage));
  const posts = docs.filter((d) => config.routes[d.collection]?.kind === 'post').sort(byDateDesc);

  // The front page is served at `/` only; astro.config.mjs redirects its own slug there, like WordPress does.
  const routes: Route[] = docs.filter((doc) => doc !== front).map((doc) => {
    if (doc === postsPage) return { url: doc.url, listing: { title: doc.title, docs: posts } };
    if (config.routes[doc.collection].kind === 'taxonomy') {
      const usedBy = config.routes[doc.collection].usedBy ?? {};
      const tagged = docs.filter((d) => {
        const field = usedBy[d.collection];
        return field && (d.values[field] ?? []).some((r: { item?: string }) => r?.item === doc.file);
      });
      return { url: doc.url, listing: { title: doc.title, docs: tagged.sort(byDateDesc) } };
    }
    return { url: doc.url, doc };
  });

  // Homepage: Settings → Reading. A static page, or the latest posts.
  routes.push(front ? { url: '/', doc: front } : { url: '/', listing: { title: site.title, docs: posts } });

  // Custom post type archives: /<post_type>/
  for (const [name, rule] of Object.entries(config.routes)) {
    if (rule.archive) routes.push({ url: rule.archive, listing: { title: rule.label, docs: docs.filter((d) => d.collection === name).sort(byDateDesc) } });
  }
  return { routes, byFile };
}

let cached: ReturnType<typeof build> | undefined;
/** Everything the site serves. Rebuilt per request in dev so edits in /admin show up on refresh. */
export function loadSite() {
  if (import.meta.env.DEV) return build();
  return (cached ??= build());
}
