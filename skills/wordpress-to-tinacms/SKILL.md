---
name: wordpress-to-tinacms
description: Migrate a WordPress website to TinaCMS on Astro, locally, by observing /wp-admin and mirroring its editorial schema. The skill drives a headless browser into /wp-admin, discovers post types / fields / taxonomies, generates matching TinaCMS collections, exports and transforms the content, and leaves you with a working local site whose /admin editor matches the WordPress editor the content team already knows.
---

# WordPress → TinaCMS migration (local, /wp-admin-driven)

You are helping a user replace a WordPress site with a TinaCMS-powered Astro site. The deliverable is a **local project** — `yarn dev` runs it, `localhost:4321/admin` serves the editor. No TinaCloud, no hosting, no DNS cutover in this skill's scope.

The guiding principle: **the TinaCMS editor should feel like the WordPress editor the team is already using.** You achieve that by observing `/wp-admin` and mirroring its schema — same post types, same field names, same groupings — before you touch any content.

## 0. Before you start

**Never modify the live WordPress site.** All work happens locally in a new project directory.

**Never log, print, or write credentials to disk** outside the user's local `.env.local` file. See step 1.

## 1. Collect credentials securely

Ask the user to create `migration/.env.local` in their working directory with:

```
WP_ADMIN_URL=https://example.com/wp-admin
WP_USERNAME=...
WP_PASSWORD=...
```

Add `migration/.env.local` to `.gitignore` immediately. Never read these values into chat; the Playwright script reads them from the env file directly.

If the WordPress site enforces 2FA or SSO on `/wp-admin`, headless login fails. Flag this up front and ask the user whether to (a) temporarily disable 2FA for the migration account, (b) use an app password / API token if the plugin supports it, or (c) run the script headed and let the user complete 2FA interactively.

## 2. Discovery

Open `discovery.md`. Ask the user the questions that aren't yet answered. Record the answers in `migration/context.md` for your own reference.

## 3. Tour /wp-admin and derive the schema

Install Playwright locally:

```bash
npm init -y
npm i -D playwright dotenv @types/node typescript tsx
npx playwright install chromium
```

Copy `scripts/wp-admin-tour.ts` from this skill into `migration/`. Run it:

```bash
npx tsx migration/wp-admin-tour.ts
```

The script logs in, walks the admin menu, visits each post type's **Add New** screen, reads ACF field groups and SEO plugin metaboxes, and emits a JSON manifest at `migration/schema.json` describing every post type and its fields. See `admin-tour.md` for exactly what the script does and how to extend it for custom plugins.

Review `migration/schema.json` with the user before generating any TinaCMS code. Flag:

- Post types with zero fields other than title/body — likely plain pages, maps to a simple Tina collection
- **ACF** field groups — each one becomes a Tina `object` field named after the group, so editors see the same panels they see in WordPress
- Yoast / Rank Math — a single `seo` object on each post type that shows the SEO metabox
- Anything in a post type's `unmapped` list — a metabox the tour saw but couldn't type. Ask the user what it is; don't guess
- Anything the tour logged as `SKIPPED` (passwords, user fields, ACF clone fields)

Each field in `schema.json` carries a `source` key saying where its value lives in WordPress (`post_title`, an ACF meta key, a Yoast meta key…). Use it in step 8 and strip it when writing the Tina collection files.

## 4. Map WordPress fields to TinaCMS collections

Open `schema-mapping.md`. For each post type in `schema.json`, generate a `tina/collections/<post-type>.ts` file using the mapping table. Keep field names identical to WordPress where possible — `title`, `date`, `author`, `featured_image`, `excerpt` — so editors see the same labels.

Do NOT invent fields the WordPress editor doesn't expose. Fidelity to the existing editorial UX is the point.

## 5. Export the content

Still inside the Playwright session, the script clicks **Tools → Export → All content** and downloads the XML to `migration/wp-export.xml`.

If the Playwright export step fails (some hosts rate-limit downloads from headless sessions), fall back: ask the user to click Tools → Export → All content manually and drop the file into `migration/wp-export.xml` themselves.

## 6. Scaffold the local project

```bash
npx create-tina-app@latest <project-name> \
  --template tina-astro-starter \
  --pkg-manager pnpm \
  --noTelemetry
```

Pick Astro by default. Switch to `tina-nextjs-starter` only if discovery indicated app-like features (user accounts, dashboards, personalization, cart/checkout).

Starter demo content strip — delete immediately so it doesn't confuse review:

```bash
rm src/content/page/{home,about}.mdx
rm -f src/content/blog/*.mdx
```

Check Node version — starter pins `>=22.22.0`. If the user is below, either upgrade Node or relax `engines.node` in `package.json`.

## 7. Install the generated collections

Drop the `tina/collections/*.ts` files from step 4 into the new project. Wire them into `tina/config.ts`:

```ts
import { PageCollection } from './collections/page';
import { PostCollection } from './collections/post';
// ... one import per post type

export default defineConfig({
  schema: {
    collections: [PageCollection, PostCollection, /* ... */]
  }
});
```

Also update the Astro content config at `src/content.config.ts` so each collection has a matching Astro content type.

## 8. Transform and import the content

Convert each `<item>` in `wp-export.xml` into a Markdown file under the matching collection folder, using the schema from step 4:

- `<wp:post_type>` → which collection folder
- `<wp:post_name>` → filename slug (`.mdx`)
- `<wp:status>publish</wp:status>` only — skip drafts unless the user asks
- `<content:encoded>` → body (strip Gutenberg block comments, convert HTML to Markdown)
- `<wp:postmeta>` → frontmatter fields: match each `<wp:meta_key>` to a field's `source.metaKey` in `schema.json`. ACF values go inside their field group's object (e.g. `venue` → `event_details.venue`)
- `<wp:attachment>` entries → download referenced images to `public/uploads/`, rewrite `<img src>` paths

## 9. Verify locally

```bash
pnpm dev     # or yarn dev --ignore-engines
```

Three sanity checks against the local dev server:

```bash
curl -sI http://localhost:4321/                               # public page: HTTP 200
curl -sI http://localhost:4321/admin/index.html               # editor shell: HTTP 200
curl -s -X POST http://localhost:4001/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ page(relativePath:\"home.mdx\"){title}}"}'  # GraphQL returns data
```

Open `http://localhost:4321/admin/index.html` in a browser. Walk through each collection and compare side-by-side with `/wp-admin`. **The fields should look familiar — same labels, same groupings, same types.** If something looks wrong, that's feedback to tighten the schema mapping, not to add a workaround.

## 10. Report back

Produce `MIGRATION-SUMMARY.md` in the new project with:

- The schema the admin tour discovered (link to `migration/schema.json`)
- Counts of what was migrated (pages, posts, media, per custom post type)
- Any post types or plugins skipped and why
- The exact commands to run the local site: `pnpm install` + `pnpm dev` + the `/admin` URL
- Known gaps vs. the WordPress editor — plugins or custom fields the schema mapping didn't cover

**Explicitly state:** this is a local project. No TinaCloud, no deploy. Converting it to a live site is a separate decision the user makes later.

## Reference

- Schema derivation deep-dive: `admin-tour.md`
- WordPress field type → TinaCMS field type table: `schema-mapping.md`
- Reference Playwright tour script: `scripts/wp-admin-tour.ts`
- Local WordPress test site (ACF + Yoast, for trying the skill without a client site): `test-sites/wordpress/` in this repo
- Case study: `examples/81military-com-au.md`
- Existing manual guide (content-only, no schema derivation): https://tina.io/docs/guides/converting-wordpress-to-tina
