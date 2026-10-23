---
name: wordpress-to-tinacms
description: Migrate an existing WordPress website to TinaCMS on Astro (default) or Next.js. Asks discovery questions, picks the right starting path based on the access the user has (admin, PHP source, or scraping), and executes the migration end-to-end including content, media, routing, and the /admin editor.
---

# WordPress → TinaCMS migration

You are helping a user replace an existing WordPress site with a TinaCMS-powered site. The target stack defaults to **Astro** (see `paths/admin-access.md`); switch to **Next.js** only if discovery indicates app-like features (see "When to pick Next.js" below).

## 0. Before you start

**Never modify the live WordPress site.** All work happens on a new TinaCMS project in a separate repository. The user keeps the current site live until they explicitly cut over.

## 1. Discovery

**Always start here.** Open `discovery.md` and ask the questions in order. Do not skip. Do not start migrating anything until every required answer is captured. Record answers in a short Markdown block the user can keep for reference:

```markdown
## Migration context
- Source URL: ...
- Entry point: admin-access | php-source | scraping
- Target frontend: astro | nextjs
- Hosting target: vercel | netlify | cloudflare-pages | self-hosted
- Content repo: same | separate
...
```

## 2. Pick a path

Based on the discovery answers, open **one** of the files under `paths/` and follow it:

| Access the user has | Path to open |
|---|---|
| WordPress admin login | `paths/admin-access.md` ← **recommended; use whenever available** |
| PHP source code / server access, no admin | `paths/php-source.md` |
| None of the above — only the public site | `paths/scraping.md` |

If discovery reveals the user has more than one, prefer admin access. It produces the cleanest export with the least guesswork about data types, taxonomies, and media URLs.

## 3. Target framework

**Default: Astro.** Astro is TinaCMS's default starter and matches the typical WordPress-replacement site (blog, agency site, business brochure, portfolio) best.

### When to pick Next.js instead

Ask one question in discovery, and switch only if the answer is yes:

> Does the current site have, or does the new site need, any of these: user accounts beyond read-only, a logged-in dashboard, server-rendered personalized pages, cart/checkout, or heavy React component libraries the team already owns?

If Next.js is picked, say so explicitly in the summary you give the user, with the specific reason.

## 4. Destination conventions

- The TinaCMS editor lives at `/admin`, **not** `/wp-admin`. Make sure the new site's docs and internal links use `/admin`.
- Content is stored as Markdown / MDX / JSON files committed to Git. There is no WordPress database.
- Set up TinaCloud for the editor backend (or self-hosted — ask in discovery).
- Preserve existing URLs where possible. If a WordPress URL has to change, add a redirect.

## 5. What to produce

By the end of the migration, deliver:

1. A new Git repository with:
   - The TinaCMS + Astro (or Next.js) project
   - Migrated content as Markdown / MDX files
   - Migrated media under `public/`
   - `tina/config.ts` with the content schema derived from the WordPress content types
2. A working `/admin` route the user can log into
3. A preview deployment URL
4. A short migration summary document listing: what was migrated, what was skipped and why, what URLs changed, and what manual work the user still needs to do (styling, forms, plugin replacements)

## 6. What NOT to automate

Stop and ask the user before:

- Pointing production DNS at the new site
- Deleting anything from the old WordPress site
- Rewriting content that doesn't survive the Markdown round-trip (e.g. shortcodes, page-builder blocks that need manual re-layout)
- Replacing plugins — list the plugins in use and ask the user how each should be handled on the new stack

## 7. Report back

When finished, output:

- A summary of what the skill migrated
- A list of plugins / shortcodes / custom post types that need human attention
- The URL of the preview deployment
- The command the user runs to start editing in `/admin`

## Reference

- Existing manual guide (content-only): https://tina.io/docs/guides/converting-wordpress-to-tina
- TinaCMS starter: `npx create-tina-app@latest`
- Astro + TinaCMS setup: https://tina.io/docs/frameworks/astro
- Next.js + TinaCMS setup: https://tina.io/docs/frameworks/next/app-router
