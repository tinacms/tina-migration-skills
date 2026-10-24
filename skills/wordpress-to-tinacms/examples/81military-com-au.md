# Case study: 81military.com.au

Pilot of the `wordpress-to-tinacms` skill against [81military.com.au](https://81military.com.au/). Local-only migration; no live deployment.

## Site profile

| Attribute | Value |
|---|---|
| Source URL | https://81military.com.au/ |
| Platform | WordPress 7.1.3 on **WP Engine** |
| Theme | Twenty Sixteen (default, unmodified) |
| Pages | 1 published (`Gateway Court`, slug `sample-page`) + 1 draft (`Privacy Policy`, default WP template) |
| Posts | 0 |
| Custom post types | None |
| Taxonomies | Just `category` (empty, no categories defined) |
| Media | 5 attachments: SSW-Sydney.jpg + 4 logo/favicon PNGs |
| Theme customization | 1 `custom_css` entry: `h2 {color:#cc4141;}` |
| Plugins visible | `honeypot` (anti-spam only) |
| Page-builders | None (plain Gutenberg) |

81military is at the minimum-complexity end of the WordPress spectrum — a near-empty install serving a single landing page. That makes it an ideal pilot because every step of the skill runs through quickly without being distracted by custom themes, page-builders, or large content sets. A richer pilot (SSW's own ssw.com.au-style site with ACF, Yoast, and dozens of CPTs) is the natural follow-up.

## What the admin tour would surface

Projecting from the WordPress export we have on hand (an admin tour against the live site would confirm):

```json
{
  "siteUrl": "https://81military.com.au",
  "wpVersion": "7.1.3",
  "postTypes": [
    {
      "name": "page",
      "label": "Pages",
      "fields": [
        { "name": "title",   "label": "Title",   "type": "string", "isTitle": true, "required": true },
        { "name": "body",    "label": "Content", "type": "rich-text" },
        { "name": "excerpt", "label": "Excerpt", "type": "string", "ui": { "component": "textarea" } }
      ]
    },
    {
      "name": "post",
      "label": "Posts",
      "fields": [
        { "name": "title",      "label": "Title",      "type": "string", "isTitle": true, "required": true },
        { "name": "body",       "label": "Content",    "type": "rich-text" },
        { "name": "excerpt",    "label": "Excerpt",    "type": "string", "ui": { "component": "textarea" } },
        { "name": "categories", "label": "Categories", "type": "reference", "list": true, "collections": ["category"] },
        { "name": "tags",       "label": "Tags",       "type": "reference", "list": true, "collections": ["tag"] }
      ]
    }
  ],
  "taxonomies": [
    { "name": "category", "label": "Categories", "postTypes": ["post"] }
  ],
  "plugins": { "acf": false, "yoast": false, "rankMath": false }
}
```

No ACF, no Yoast, no custom post types — the schema is the WordPress default. A real site with plugin-driven editorial UX would surface richer field sets here, and the mapper in `schema-mapping.md` would translate them.

## Pilot output (local)

Repo: [SSWConsulting/81military](https://github.com/SSWConsulting/81military)

| Artifact | Where |
|---|---|
| Astro + TinaCMS site | `~/ClaudeCode/81military-site/` (local) |
| Collections generated | `tina/collections/page.ts`, `tina/collections/post.ts` (per the derived schema above) |
| Migrated content | `src/content/page/home.mdx` (Gateway Court, served at `/`) |
| Migrated media | `public/uploads/*` (5 files) |
| Verified | `yarn dev` → `/` renders Gateway Court, `/admin/index.html` loads TinaCMS editor, GraphQL returns the migrated page ✓ |

**Scope boundary:** this pilot stops at local. TinaCloud + Vercel deployment is deliberately out of scope for this skill (see the "Local-first delivery" principle in the repo README). If the user later wants a hosted preview, that's a separate decision following standard TinaCMS deployment docs.

## How to run the pilot locally

```bash
git clone https://github.com/SSWConsulting/81military.git
cd 81military
yarn install --ignore-engines
yarn dev
# Public site: http://localhost:4321/
# Editor:      http://localhost:4321/admin/index.html
```

## Lessons learned (fed back into the skill)

1. **For near-empty sites, `wordpress-export-to-markdown` is wrong-first** — it's post-biased and produces nothing for page-only sites. The skill now counts `<wp:post_type>` entries and branches.
2. **The XML already contains full media URLs** via `<wp:attachment_url>` — cleaner than enumerating via the REST API.
3. **Starter's `engines.node >=22.22.0` is stricter than Astro actually needs** — the skill checks early and either upgrades or relaxes.
4. **Starter ships demo content** (`home.mdx`, `about.mdx`, blog posts) that would leak into production — the skill strips immediately after scaffolding.
5. **The Astro starter's `page` collection uses a block-based schema**, not a flat body field. For a WordPress page, mapping to a single `content` block holding the body is the straightforward move; a richer page with hero + feature grid + CTA justifies hand-crafting multiple blocks.
6. **Gutenberg block comments strip cleanly** — the HTML inside the `<!-- wp:... -->` wrappers is the content.
7. **Heading-level semantics are a conversion decision** — the Gateway Court page used `<h4>` as styled section dividers and `<h2>` for business names. Preserve by default; ask before "cleaning up" semantics.
8. **The `custom_css` post type carries real styling** — surface for the user to decide: port into the new site's global CSS, apply site-wide, or drop.

## Still-open follow-ups

- [ ] Run the Playwright `wp-admin-tour.ts` against a live `/wp-admin` for the first time — the script is a reference implementation and needs validation. 81military would need admin creds; a richer SSW site would exercise more of the script.
- [ ] Test the script against a site with ACF + Yoast to validate the plugin-detection and field-mapping paths.
