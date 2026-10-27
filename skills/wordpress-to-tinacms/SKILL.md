---
name: wordpress-to-tinacms
description: Migrate a WordPress website to TinaCMS on Astro, locally, by observing /wp-admin and mirroring its editorial schema. The skill drives a headless browser into /wp-admin, discovers post types / fields / taxonomies / ACF field groups / SEO plugins, generates matching TinaCMS collections, exports and transforms the content, and leaves you with a working local site whose /admin editor matches the WordPress editor the content team already knows. Use when the user wants to move, migrate or convert a WordPress site to TinaCMS.
argument-hint: "[wordpress-site-url]"
---

# WordPress → TinaCMS migration (local, /wp-admin-driven)

You are helping a user replace a WordPress site with a TinaCMS-powered Astro site. The deliverable is a **local project**: `pnpm dev` runs it and `localhost:4321/admin` serves the editor. TinaCloud, hosting and DNS cutover are out of this skill's scope.

The guiding principle: **the TinaCMS editor should feel like the WordPress editor the team is already using.** You get there by observing `/wp-admin` and mirroring its schema (same post types, same field names, same groupings) before you touch any content.

This skill's folder is `${CLAUDE_SKILL_DIR}`. Claude Code fills in that path; in other tools, use the folder this `SKILL.md` is in. The steps copy three scripts from its `scripts/` folder and a few Astro files from `templates/astro/`. Run every command from the new project's root.

WordPress site to migrate, if the user passed one: $ARGUMENTS

## 0. Before you start

**Never modify the live WordPress site.** The tour only reads screens and clicks the standard Export buttons.

**Never log, print, or write credentials** anywhere except `migration/.env.local`, which must be gitignored before it exists. Never read its values into chat.

## 1. Discovery

Open `discovery.md` and ask the questions that aren't answered yet. If the site URL was passed above or is in the user's message, don't ask for it again. Record the answers in `migration/context.md` once the project exists (step 2).

If `/wp-admin` enforces 2FA or SSO, headless login fails. Ask whether to (a) use a migration account without 2FA, (b) use an app password if the plugin supports it, or (c) run the tour with `HEADLESS=false` so the user completes 2FA in the browser window.

## 2. Scaffold the project and lock down `migration/`

```bash
npx create-tina-app@latest <project-name> --template tina-astro-starter --pkg-manager pnpm --noTelemetry
cd <project-name>
printf '\n# WordPress migration working files: credentials, raw export (has author emails), tooling\nmigration/*\n!migration/schema.json\n!migration/context.md\n!migration/transform-report.json\n' >> .gitignore
```

Do the `.gitignore` step **before** creating anything in `migration/`, so credentials and the raw export can never be committed.

Use Astro by default. Use `tina-nextjs-starter` only if discovery found app-like features (accounts, dashboards, cart/checkout), and say why.

Don't install the site's dependencies yet. First prove the WordPress login works (step 3).

## 3. Credentials, migration tooling and a login check

Ask the user to create `migration/.env.local`:

```
WP_ADMIN_URL=https://example.com/wp-admin
WP_USERNAME=...
WP_PASSWORD=...
```

Install the migration tooling in its own `package.json`, so none of it ends up in the site's dependencies:

```bash
cp "${CLAUDE_SKILL_DIR}"/scripts/*.ts migration/
(cd migration && npm init -y && npm i -D playwright dotenv tsx typescript @types/node fast-xml-parser turndown @types/turndown yaml && npx playwright install chromium)
```

Every script below runs from the project root as `migration/node_modules/.bin/tsx migration/<script>.ts`.

**Check the login before anything else:**

```bash
migration/node_modules/.bin/tsx migration/wp-admin-tour.ts --check
```

It logs in, confirms the account can open Plugins, Tools → Export and Settings (the screens the tour needs), and stops. It writes nothing. If it fails:

| Message | Fix |
|---|---|
| `Login rejected` | Wrong username or password, or 2FA. See step 1 for the 2FA options |
| `Logged in but no admin menu` | A firewall, SSO page or security plugin is in the way. Try `HEADLESS=false`, or see `admin-tour.md` |
| `this account can't open …` | Not an Administrator. Ask for an Administrator account (an Editor can't export) |

Don't go on until the check passes. Then install the site:

```bash
pnpm install
```

Known starter snags:

- **pnpm 11** stops with `ERR_PNPM_IGNORED_BUILDS` for `workerd` and writes `workerd: set this to true or false` into `pnpm-workspace.yaml`. Set it to `false` (only Cloudflare deploys need it) and run `pnpm install` again.
- **Node:** the starter pins `engines.node >=22.22.0`. Older 22.x versions work with an engine warning. Upgrade Node if the user prefers.
- **"This project is configured to use yarn"**: a `packageManager` field in a parent folder's `package.json` (e.g. `~/package.json`). Run pnpm with `COREPACK_ENABLE_STRICT=0`.

## 4. Tour /wp-admin

```bash
migration/node_modules/.bin/tsx migration/wp-admin-tour.ts
```

The tour does the following, all read-only:

- logs in and reads Settings (site title, permalinks, front page) and the active plugins
- visits every post type's **Add New** screen, and exports ACF field groups through ACF → Tools
- writes `migration/schema.json`
- downloads **Tools → Export → All content** to `migration/wp-export.xml`

See `admin-tour.md` for details and failure modes. If the export download fails, ask the user to export by hand and save the file as `migration/wp-export.xml`.

**Review `schema.json` with the user before going on.** Walk through each post type and flag:

- **ACF field groups.** Each one is a Tina `object` named after the group, so editors get the same panel they have in WordPress.
- **`seo` objects** from Yoast / Rank Math.
- **Anything in a post type's `unmapped` list.** These are metaboxes the tour saw but couldn't type. Ask what they hold; don't guess.
- **Fields the tour logged as `SKIPPED`** (passwords, user fields, ACF clone fields).

Each field carries a `source` key that records where its value lives in WordPress. The next two scripts use it.

## 5. Generate the collections

```bash
migration/node_modules/.bin/tsx migration/generate-collections.ts
```

This writes one `tina/collections/wordpress/<name>.ts` per post type and taxonomy, using the mappings in `schema-mapping.md`. It also writes the URL rules (WordPress permalinks) to `src/lib/wordpress.json`. Read its warnings: unsupported permalink structures, and references to post types that weren't migrated.

Do NOT add fields the WordPress editor doesn't have. Fidelity to the existing editorial UX is the point. If something needs changing, edit `schema.json` and re-run, or edit the generated files once you stop regenerating.

## 6. Replace the starter's demo content model

The starter's `page` and `blog` collections, routes and visual-editing islands are demo content. Swap them for the generated model and a generic set of pages that follow the WordPress URLs:

```bash
rm -rf src/content/blog src/content/page src/pages/blog src/pages/index.astro 'src/pages/[...slug].astro' src/pages/rss.xml.ts \
  src/components/blocks src/components/islands src/layouts/BlogPost.astro tina/collections/blog.ts tina/collections/page.ts
cp -R "${CLAUDE_SKILL_DIR}"/templates/astro/. .
node -e 'const f="tsconfig.json",t=JSON.parse(require("fs").readFileSync(f));t.exclude.push("migration");require("fs").writeFileSync(f,JSON.stringify(t,null,2)+"\n")'
```

The templates replace `tina/config.ts`, `src/lib/data.ts` and `src/lib/islands.ts`, and add:

- `src/pages/[...path].astro`, a single route for every entry, the homepage, the posts page, CPT archives and term pages
- a generic `Entry` / `EntryList` / `FieldValue` set of components that renders every field using the labels from the WordPress editor

These pages are a starting point that shows all the content works. They are not the final design: the team rewrites them as real Astro templates later. Header and footer keep click-to-edit. Migrated entries are edited through the `/admin` form.

## 7. Transform the content

```bash
migration/node_modules/.bin/tsx migration/transform-content.ts          # add --drafts to include drafts
```

What it does:

- **Entries:** writes every published entry to `src/content/<collection>/<slug>.mdx`. Child pages nest under their parent's folder.
  - Gutenberg markup becomes Markdown.
  - ACF values go into their group objects, and PHP-serialized arrays (checkboxes, relationships, links) are decoded.
  - Relationships become references, and Yoast / Rank Math meta becomes `seo`.
- **Terms:** writes taxonomy terms to `src/content/<taxonomy>/<slug>.json`.
- **Media:** downloads it to `public/uploads/`, keeping WordPress's paths, and rewrites the URLs.
- **Site settings:**
  - Merges the site title, tagline and the first WordPress menu into `src/content/config/config.json`.
  - Records the front page and posts page in `src/lib/wordpress.json`.
  - Points the starter's `/home` → `/` redirect at the real front-page slug.

Read `migration/transform-report.json`:

- **`urlMismatches`**: old URLs that changed. Each one needs a redirect.
- **`skipped`**: drafts and other entries that weren't migrated.
- **`warnings`**: resolved SEO template variables and failed media downloads.

## 8. Verify locally

```bash
pnpm run build:local      # TinaCMS indexes every file; MDX that doesn't parse fails here
pnpm dev
```

Stop `pnpm dev` before running `build:local` again, because both use port 9000.

Check:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4321/                 # 200
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4321/admin/index.html # 200
```

Then open the site in a browser:

1. Visit one entry of every post type, plus the posts page and a term page, at their **old WordPress URLs**.
2. Open `/admin`, open an entry of every post type, and compare it side by side with the same screen in `/wp-admin`. **The fields should look familiar: same labels, same panels, same types.**
3. Edit one field, save, and confirm the change shows on the page.

If something looks wrong, tighten the mapping (in `schema.json` or the generator) rather than patching the output.

## 9. Report back

Write `MIGRATION-SUMMARY.md` in the project with:

- What the tour found (link `migration/schema.json`), including plugins and any `unmapped` or skipped fields
- Counts from `migration/transform-report.json`: entries per post type, terms, media
- URLs that changed and need redirects
- Commands to run it: `pnpm install`, `pnpm dev`, then `http://localhost:4321/admin`
- Known gaps vs. the WordPress editor: anything not mapped, and that the public pages are generic placeholders

**State explicitly:** this is a local project. No TinaCloud, no deploy. Going live is a separate decision.

## Reference

- Schema derivation and failure modes: `admin-tour.md`
- WordPress field type → TinaCMS field type: `schema-mapping.md`
- Scripts: `scripts/wp-admin-tour.ts`, `scripts/generate-collections.ts`, `scripts/transform-content.ts`
- Astro files: `templates/astro/`
- Local WordPress test site (ACF + Yoast) for trying the skill without a client site: `test-sites/wordpress/` in this repo
- Case studies: `examples/test-site.md` (full run), `examples/81military-com-au.md` (first, XML-only pilot)
- Existing manual guide (content only, no schema derivation): https://tina.io/docs/guides/converting-wordpress-to-tina
