---
name: wordpress-to-tinacms
description: Migrate a WordPress website to TinaCMS on Astro, locally, by observing /wp-admin and mirroring its editorial schema. The skill drives a headless browser into /wp-admin, discovers post types / fields / taxonomies / ACF field groups / SEO plugins, generates matching TinaCMS collections, exports and transforms the content, and leaves you with a working local site whose /admin editor matches the WordPress editor the content team already knows. Use when the user wants to move, migrate or convert a WordPress site to TinaCMS.
argument-hint: "[wordpress-site-url]"
---

# WordPress → TinaCMS migration (local, /wp-admin-driven)

You are replacing a WordPress site with a TinaCMS-powered Astro site. The deliverable is a **local project, running**: the site at `http://localhost:4321` and the editor at `http://localhost:4321/admin`, plus a checklist for putting it live. You don't deploy anything.

The guiding principle: **the TinaCMS editor should feel like the WordPress editor the team is already using.** You get there by observing `/wp-admin` and mirroring its schema (same post types, same field names, same groupings) before you touch any content.

This skill's folder is `${CLAUDE_SKILL_DIR}`. Claude Code fills in that path; in other tools, use the folder this `SKILL.md` is in. The steps copy four scripts from its `scripts/` folder and a few Astro files from `templates/astro/`.

WordPress site to migrate, if the user passed one: $ARGUMENTS

## How a run goes

**One prompt in, a running site out.** Work through every step without stopping, except at the stop points below. Use the defaults in `discovery.md` instead of asking questions.

The user does **one thing**: puts an Administrator login in a file (step 3). Everything else is yours.

Stop and ask only when:

- there's no site URL in the prompt
- the site doesn't look like WordPress, or its login page isn't at `/wp-login.php` (step 1)
- you need the credentials (step 3, once)
- the login check fails (step 3)
- the export download fails (step 4)
- the build fails and you can't fix it (step 8)

Start with a short message, then go straight to step 1 without waiting for a reply. Say:

- what's about to happen: read the site, set up a TinaCMS project, copy the editor and the content, start it locally
- the one thing you'll need from the user: an Administrator login, put in a file, never in the chat

## 0. Rules

**Never modify the live WordPress site.** The tour only reads screens and clicks the standard Export buttons.

**Never log, print, or write credentials** anywhere except `migration/.env.local`, which must be gitignored before it exists. Never read its values into chat, and never ask for them in chat.

## 1. Read the site (no login yet)

Take the URL from above or from the user's message. Check it's WordPress, and that its login page is where the tour expects it:

```bash
curl -s -o /dev/null -w '%{http_code}\n' <url>/wp-login.php   # 200 = standard WordPress login
curl -s <url>/wp-json/ | head -c 400                          # the site's name and description, if the REST API is on
```

- **`wp-login.php` is 200:** carry on.
- **`wp-login.php` is 404 but `/wp-json/` answers:** a security plugin moved the login page. Stop and ask for an export file instead (see [No Administrator login](#no-administrator-login)).
- **Neither answers:** stop and say the site doesn't look like WordPress, or it blocks scripted requests.

Pick the project folder: the site's host name with dots turned into dashes, plus `-tinacms`, in the current folder (`https://www.example.com` → `example-com-tinacms`). Drop a leading `www.` and any port (`localhost:8080` → `localhost-tinacms`).

## 2. Scaffold the project and lock down `migration/`

```bash
npx create-tina-app@latest <project-folder> --template tina-astro-starter --pkg-manager pnpm --noTelemetry
cd <project-folder>
printf '\n# WordPress migration working files: credentials, raw export (has author emails), tooling\nmigration/*\n!migration/schema.json\n!migration/context.md\n!migration/transform-report.json\n' >> .gitignore
```

Do the `.gitignore` step **before** creating anything in `migration/`, so credentials and the raw export can never be committed. Run every later command from the project root.

`create-tina-app` installs the site's dependencies itself. If that ends with `ERR_PNPM_IGNORED_BUILDS` for `workerd`, carry on: step 3 fixes it.

Write `migration/context.md`: the site URL, the date, and the defaults you're using from `discovery.md`.

## 3. Credentials (the one pause) and tooling

Create the credentials file yourself, with the login URL filled in and the secrets left blank:

```bash
cat > migration/.env.local <<'EOF'
WP_ADMIN_URL=<url>/wp-admin
WP_USERNAME=
WP_PASSWORD=
# If the login asks for a 2FA code, remove the # on the next line. A browser window opens for you to enter it.
# HEADLESS=false
EOF
```

Tell the user:

- the file's **full path**
- to fill in the username and password of an **Administrator** account and save the file
- not to paste them in the chat
- that you'll carry on setting up and continue by yourself once the file is saved

Without waiting, install the migration tooling in its own `package.json`, so none of it ends up in the site's dependencies. Then finish installing the site:

```bash
cp "${CLAUDE_SKILL_DIR}"/scripts/*.ts migration/
(cd migration && npm init -y && npm i -D playwright dotenv tsx typescript @types/node fast-xml-parser turndown @types/turndown yaml && npx playwright install chromium)
pnpm install
```

Known `pnpm install` snags. Fix them yourself:

- **`ERR_PNPM_IGNORED_BUILDS` for `workerd`** (recent pnpm, often already during `create-tina-app`): pnpm writes `workerd: set this to true or false` into `pnpm-workspace.yaml`. Set it to `false` (only Cloudflare deploys need it) and run `pnpm install` again.
- **"This project is configured to use yarn"**: a `packageManager` field in a parent folder's `package.json` (e.g. `~/package.json`). Run pnpm with `COREPACK_ENABLE_STRICT=0`.
- **Node:** the starter wants Node `>=22.22.0`. Older 22.x versions work with an engine warning. Mention it in the summary.

Then wait for the credentials without asking again. Check every 5 seconds, for up to 10 minutes, with a loop that never prints the file:

```bash
for i in {1..120}; do grep -q '^WP_USERNAME=.' migration/.env.local && grep -q '^WP_PASSWORD=.' migration/.env.local && echo ready && break; sleep 5; done
```

If it times out, or your environment doesn't allow waiting, ask the user to say when the file is saved.

**Check the login:**

```bash
migration/node_modules/.bin/tsx migration/wp-admin-tour.ts --check
```

It logs in, confirms the account can open Plugins, Tools → Export and Settings (the screens the tour needs), and stops. It writes nothing. If it fails, tell the user what to change in the file, wait for it again, and re-run the check:

| Message | Fix |
|---|---|
| `Login rejected` | Wrong username or password, or the login needs a 2FA code. For 2FA, remove the `#` before `HEADLESS=false` |
| `Logged in but no admin menu` | A firewall, SSO page or security plugin is in the way. Try `HEADLESS=false`, or see `admin-tour.md` |
| `this account can't open …` | Not an Administrator. Ask for an Administrator login, or use [No Administrator login](#no-administrator-login) |

### No Administrator login

If nobody can give you an Administrator login, ask for files instead. Someone who has one saves:

1. **Tools → Export → All content** as `migration/wp-export.xml`
2. **If the site uses ACF:** ACF → Tools → Export As JSON, with every field group ticked, as `migration/acf-field-groups.json`. The `.json` files in the theme's `acf-json/` folder also work.

Then build the schema from those files and skip to step 5:

```bash
migration/node_modules/.bin/tsx migration/wp-admin-tour.ts --from-export
```

Tell the user this schema is **projected from stored content, not observed in the editor**. A field nobody has filled in yet won't appear. The summary must say so.

## 4. Tour /wp-admin

```bash
migration/node_modules/.bin/tsx migration/wp-admin-tour.ts
```

The tour does the following, all read-only:

- logs in and reads Settings (site title, permalinks, front page) and the active plugins
- visits every post type's **Add New** screen, and exports ACF field groups through ACF → Tools
- writes `migration/schema.json`
- downloads **Tools → Export → All content** to `migration/wp-export.xml`

See `admin-tour.md` for details and failure modes. If the export download fails, stop and ask the user to export by hand and save the file as `migration/wp-export.xml`.

Post a short summary of `schema.json` in the chat and **keep going**. Don't wait for a reply:

- every post type and its fields
- each ACF field group, which becomes a Tina `object` with the same panel name
- the `seo` object, if the site uses Yoast or Rank Math

Collect these for **Needs a decision** in the summary:

- **Each post type's `unmapped` list:** metaboxes the tour saw but couldn't type. Their content isn't migrated.
- **Fields the tour logged as `SKIPPED`:** passwords, user fields, ACF clone fields.
- **Plugins whose features don't come across**, from `plugins.active`. Look for:
  - shop: `woocommerce`, `easy-digital-downloads`
  - members: `memberpress`, `paid-memberships-pro`, `buddypress`, `bbpress`
  - courses: `learndash`, `lifterlms`, `sensei-lms`
  - forms: `contact-form-7`, `wpforms-lite`, `gravityforms`, `ninja-forms`, `formidable`
  - multilingual: `polylang`, `sitepress-multilingual-cms`
- **Comments:** `transform-content.ts` counts them in step 7. They aren't migrated.

Each field carries a `source` key that records where its value lives in WordPress. The next two scripts use it.

## 5. Generate the collections

```bash
migration/node_modules/.bin/tsx migration/generate-collections.ts
```

This writes one `tina/collections/wordpress/<name>.ts` per post type and taxonomy, using the mappings in `schema-mapping.md`. It also writes the URL rules (WordPress permalinks) to `src/lib/wordpress.json`. Its warnings go into the summary: unsupported permalink structures, and references to post types that weren't migrated.

Do NOT add fields the WordPress editor doesn't have. Fidelity to the existing editorial UX is the point.

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
- **Redirects:** writes `redirects` in `astro.config.mjs`, so the front page's slug goes to `/` and every URL that changed goes to its new address.

`migration/transform-report.json` lists every new URL, the URLs that changed, entries skipped (drafts), approved comments (not migrated), and warnings (resolved SEO template variables, failed media downloads).

## 8. Build, start and check

```bash
pnpm run build:local      # TinaCMS indexes every file; MDX that doesn't parse fails here
```

If the build fails on a content file, fix the cause (usually the mapping in `schema.json`, or a character MDX can't take), re-run steps 5 and 7, and build again. Tighten the mapping rather than patching output by hand.

Then start the site **in the background** and leave it running for the user:

```bash
pnpm dev
```

Wait until `http://localhost:4321/` answers, then check every migrated URL, every old URL that changed (it should redirect), and the editor:

```bash
migration/node_modules/.bin/tsx migration/check-site.ts
```

Fix any failure before you report. `build:local` and `pnpm dev` both use port 9000, so stop `pnpm dev` before building again.

## 9. Report back

Write `MIGRATION-SUMMARY.md` in the project:

- **What the tour found** (link `migration/schema.json`): post types, ACF groups, SEO plugin. If the schema came from `--from-export`, say it was projected, not observed.
- **What was migrated**, from `migration/transform-report.json`: entries per post type, terms, media files.
- **Changed URLs**, and that each one already redirects.
- **Needs a decision:** everything collected in step 4, plus generator and transform warnings. Write "Nothing" if it's empty.
- **Known gaps:** the public pages are generic placeholders for the team to design. Migrated entries are edited in the `/admin` form; only the header and footer are click-to-edit.
- **Run it again later:** `pnpm install`, `pnpm dev`, then `http://localhost:4321/admin`.
- **Going live**, filled in for this site:
  1. **Review** the local site with the content team, and settle **Needs a decision**.
  2. **Push the code to GitHub.** Create an empty repository, add it as `origin`, commit and push. `migration/` stays out, apart from the schema, context and report.
  3. **Connect TinaCloud.** At [app.tina.io](https://app.tina.io), create a project from the repository and invite the editors. Copy its Client ID and a read-only token into `PUBLIC_TINA_CLIENT_ID` and `TINA_TOKEN` (see `.env.example`).
  4. **Deploy.** Import the repository into Vercel, Netlify or Cloudflare. The starter picks the right adapter by itself. Set the two TinaCloud variables, plus `SITE_URL` with the real domain.
  5. **Freeze and refresh.** Stop edits in WordPress, re-run the tour (or `--from-export` with a fresh export) and `transform-content.ts`, then commit and push. Late changes come across.
  6. **Switch the domain.** Point DNS at the new host. The redirects for changed URLs are already in `astro.config.mjs`. Submit `/sitemap-index.xml` in Google Search Console, and keep the WordPress site, offline or on another host name, for a few weeks.

Then reply in the chat with **only**:

- the site URL and the `/admin` URL (`pnpm dev` is running)
- one line of counts
- the **Needs a decision** items, or "nothing needs a decision"
- "To go live, see MIGRATION-SUMMARY.md", and its first step

## Reference

- Defaults and the few questions worth asking: `discovery.md`
- Schema derivation, `--from-export` and failure modes: `admin-tour.md`
- WordPress field type → TinaCMS field type: `schema-mapping.md`
- Scripts: `scripts/wp-admin-tour.ts`, `scripts/generate-collections.ts`, `scripts/transform-content.ts`, `scripts/check-site.ts`
- Astro files: `templates/astro/`
- Local WordPress test site (ACF + Yoast) for trying the skill without a client site: `test-sites/wordpress/` in this repo
- Case studies: `examples/test-site.md` (full run), `examples/81military-com-au.md` (first, XML-only pilot)
- Existing manual guide (content only, no schema derivation): https://tina.io/docs/guides/converting-wordpress-to-tina
