# Case study: 81military.com.au

A worked example of the `wordpress-to-tinacms` skill applied to [81military.com.au](https://81military.com.au/).

## Site profile (from discovery)

| Attribute | Value |
|---|---|
| Source URL | https://81military.com.au/ |
| Platform | WordPress on **WP Engine** |
| Theme | Twenty Sixteen (default WordPress theme, unmodified) |
| Pages | 1 — "Gateway Court" (slug: `sample-page`) |
| Posts | 0 |
| Custom post types | None detected |
| Media items | 5 — four SSW logo/favicon variants, one Sydney office photo |
| Plugins visible | `honeypot` (anti-spam only) |
| Page-builders | None (plain Gutenberg) |
| Forms | None |
| REST API | Open — `/?rest_route=/wp/v2/pages` returns JSON |

The site is a near-empty WordPress install serving a single landing page. It's an ideal baseline because every step of the migration runs end-to-end quickly, without being complicated by custom themes, page-builders, or large content sets.

## Entry point

**Admin access** — the recommended path. (Credentials needed from the user to actually run the migration.)

## Target stack (recommended)

- **Frontend:** Astro — content-first, zero-JS by default, matches a brochure site
- **Content storage:** TinaCMS Markdown in the same Git repo as the Astro project
- **Editor backend:** TinaCloud (free tier is enough — single page, five images)
- **Hosting:** Vercel preview deploy during migration; final hosting decision at cut-over
- **Editor URL:** `/admin` (not `/wp-admin`)

## Expected migration output

Pre-flight prediction based on the recon above:

- 1 Markdown file: `src/content/pages/sample-page.mdx` (title: "Gateway Court") — or renamed to `gateway-court.mdx` with a redirect from `/sample-page`
- 5 media files copied into `public/uploads/`
- A `tina/config.ts` with a `pages` collection (title, slug, body, seo)
- An Astro route at `src/pages/[...slug].astro` that renders the content
- A single redirect: `/sample-page` → `/gateway-court` (if slug is cleaned up)
- Honeypot plugin: no replacement needed — the new site has no public forms

## Status

**Not yet executed.** This case study will be filled in with the actual migration output, screenshots, and lessons learned once an admin login is provided and the pilot runs.

Open items before the pilot can run:

- [ ] WordPress admin credentials for 81military.com.au
- [ ] Decision on the target repo location (`SSWConsulting/81military-com-au` or similar)
- [ ] Vercel / Netlify / Cloudflare Pages account for the preview deploy
