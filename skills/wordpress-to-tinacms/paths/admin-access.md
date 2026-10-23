# Path: WordPress admin access (primary)

Use this path when the user has a working `/wp-admin` login. It produces the cleanest migration.

## Prerequisites

- `migration-context.md` from the discovery step
- WordPress admin credentials
- Local Node.js 18+ and `pnpm` or `npm`
- A GitHub account with permission to create a repo

## Steps

### 1. Scaffold the new TinaCMS + Astro project

Check Node first — the Astro starter's `engines.node` is pinned to `>=22.22.0` even though builds work on 22.14+. If the user is below 22.22, either upgrade or relax the engines field (and note it in the migration summary).

```bash
npx create-tina-app@latest <project-name> \
  --template tina-astro-starter \
  --pkg-manager pnpm \
  --noTelemetry
```

Pick the Next.js starter (`tina-nextjs-starter`) only if discovery concluded Next.js.

Open the new project and verify it starts:

```bash
cd <project>
pnpm install
pnpm dev
```

The site runs at `http://localhost:3000`, with the editor at `http://localhost:3000/admin`.

Commit this clean starter as the first commit. All subsequent migration work goes on branches.

**Starter demo content:** the Tina Astro starter ships with `src/content/page/{home,about}.mdx` and several `src/content/blog/*.mdx` files. Decide now whether to strip them before you start adding migrated content, or at the end as a cleanup pass. Either way, call it out in the migration summary so the user doesn't ship demo content live.

### 2. Export WordPress content

In `/wp-admin`:

1. Go to **Tools → Export**
2. Choose **All content**
3. Download the resulting XML file. Rename it to `wp-export.xml`.

Save `wp-export.xml` in a `migration/` directory in the new project (gitignored).

### 3. Count what's in the export, then branch

Open `wp-export.xml` and count by `<wp:post_type>`:

```bash
grep -oE "<wp:post_type><!\[CDATA\[[^]]+\]\]></wp:post_type>" migration/wp-export.xml | sort | uniq -c
```

Typical output:

```
      5 attachment
      2 page
     12 post
      1 custom_css
```

Branch based on counts:

- **If posts > 0:** use [`wordpress-export-to-markdown`](https://github.com/lonekorean/wordpress-export-to-markdown):
  ```bash
  npx wordpress-export-to-markdown \
    --input migration/wp-export.xml \
    --output src/content/blog \
    --folder-mode post-folder \
    --save-images all
  ```
- **If posts = 0:** skip `wordpress-export-to-markdown` entirely — it's biased toward posts and produces nothing useful for page-only sites. Go straight to step 4.

Also note:
- **`custom_css` entries** carry theme-level CSS the user wrote (often colors, overrides). Open them and decide whether to port into the new site's global CSS, apply site-wide, or drop. Surface the decision in the migration summary.
- **Draft pages/posts** (`<wp:status>draft</wp:status>`) are usually test content left over from WP's install (e.g. the default Privacy Policy page). Skip them unless the user says otherwise.

### 4. Migrate pages separately

The exporter above is biased toward posts. For pages:

1. In `/wp-admin → Pages`, note the page list (or hit `<url>/?rest_route=/wp/v2/pages` if the REST API is open).
2. For each page: Copy the content from the WordPress editor's "Code editor" view (not visual editor). Paste into a new `.mdx` file under `src/content/pages/<slug>.mdx`.
3. Flag any page containing shortcodes (`[gallery]`, `[contact-form-7]`, etc.) — these need manual replacement with Astro/React components.

For sites with many pages, use the REST API to script this step:

```bash
curl -s "<url>/?rest_route=/wp/v2/pages&per_page=100" | \
  jq -r '.[] | "src/content/pages/\(.slug).mdx\n---\ntitle: \"\(.title.rendered)\"\n---\n\(.content.rendered)"'
```

The HTML content still needs cleanup — WP's editor emits a lot of inline styles and block comments. Pipe through a markdown converter such as `turndown`.

### 5. Move media

The export XML contains full `<wp:attachment_url>` entries for every media item — that's the cleanest source. Extract and download them:

```bash
grep -oE "<wp:attachment_url><!\[CDATA\[[^]]+\]\]></wp:attachment_url>" migration/wp-export.xml \
  | sed -E 's/.*\[CDATA\[(.+)\]\].*/\1/' \
  | while read url; do
      curl -sS -o "public/uploads/$(basename "$url")" "$url"
    done
```

If the site has an organized folder structure (`/wp-content/uploads/2024/03/foo.jpg`) and you want to preserve it, mirror the path:

```bash
# ... | while read url; do
#   path="public/uploads/$(echo "$url" | sed -E 's|.*/wp-content/uploads/||')"
#   mkdir -p "$(dirname "$path")" && curl -sS -o "$path" "$url"
# done
```

If `wordpress-export-to-markdown` ran with `--save-images all`, images beside posts are already in `src/content/blog/<slug>/`.

Rewrite any remaining `https://<old-site>/wp-content/uploads/...` references in your migrated content to `/uploads/...` with a `sed` pass:

```bash
find src/content -type f -name "*.mdx" -exec sed -i '' -E \
  "s|https://<old-site>/wp-content/uploads/[0-9]{4}/[0-9]{2}/|/uploads/|g" {} +
```

Verify no broken references remain:

```bash
grep -rE "src=['\"](http[s]?://|/wp-content)" src/content/ | head
```

### 6. Define the TinaCMS schema

Open `tina/config.ts`. Add a collection per content type the site actually uses. Typical shape for a WordPress → TinaCMS site:

- `pages` — top-level pages with free-form `body` and `seo` fields
- `posts` — blog posts with `title`, `date`, `author`, `categories`, `tags`, `body`
- `settings` — one global for site title, nav menu, footer links

Mirror the custom post types discovered in step 2 of discovery. Keep field names close to WordPress (`title`, `date`, `excerpt`, `featured_image`) so references don't need rewriting.

### 7. Build the Astro pages

For each collection, create an Astro route that reads the Markdown and renders it:

- `src/pages/index.astro` → home page (either a `pages/home.mdx` or a landing-page component)
- `src/pages/[...slug].astro` → generic page renderer
- `src/pages/blog/[...slug].astro` → blog post renderer (skip if no posts)

The existing manual guide at https://tina.io/docs/guides/converting-wordpress-to-tina covers the exact Astro + content-collection patterns.

### 8. Verify the `/admin` route locally

Run the dev server:

```bash
pnpm dev     # or yarn dev — the starter runs `tinacms dev -c "astro dev"`
```

Three sanity checks against the local dev server (default Astro port `4321`):

```bash
# 1. Public page renders
curl -sI http://localhost:4321/

# 2. Editor shell loads
curl -sI http://localhost:4321/admin/index.html

# 3. TinaCMS GraphQL returns the migrated content
curl -s -X POST http://localhost:4001/graphql \
  -H "Content-Type: application/json" \
  -d '{"query":"{ page(relativePath:\"home.mdx\"){seoTitle}}"}'
```

Open `http://localhost:4321/admin/index.html` in a browser — the TinaCMS editor should load with every collection editable. If a field is missing or shows raw HTML where rich-text is expected, revisit the schema in step 6.

**At this point the site works end-to-end in local dev. It is NOT yet editable on a deployed site — that needs TinaCloud + hosting, next.**

### 9. Set up redirects

For each WordPress URL that didn't survive, add a redirect in `astro.config.mjs`:

```js
export default defineConfig({
  redirects: {
    '/old-url': '/new-url',
    '/?page_id=42': '/about',
  }
});
```

### 10. Push to GitHub

```bash
git add -A
git commit -m "Migrate from WordPress"
gh repo create <org>/<repo> --public --source=. --push
```

Pick a clear repo name tied to the site domain (e.g. `SSWConsulting/81military` for `81military.com.au`). The repo is where TinaCloud will read and commit content.

### 11. Create the TinaCloud project

TinaCloud is the hosted backend that lets `/admin` work on a deployed site. Local `yarn dev` works without it; production doesn't.

1. Go to **https://app.tina.io** and sign in with GitHub.
2. **Create a new project** → **Import existing project** → pick the repo you just pushed.
3. Grant TinaCloud read/write access to that repo when the GitHub permission prompt appears.
4. Configure:
   - **Branch:** `main` (or whichever branch holds the editable content)
   - **Path to Tina config:** blank unless the repo is a monorepo
   - **Site URL(s):** `http://localhost:4321` (for local), and the production URL once it exists. TinaCloud only serves the editor on URLs listed here.
5. Finish the wizard. TinaCloud lands you on the **Overview** page with the project's **Client ID**.
6. Go to the **Tokens** tab → generate a **Content token** (read-only) → copy it.

You now have the three values the deployed site needs:

- `NEXT_PUBLIC_TINA_CLIENT_ID` — the Client ID from Overview
- `TINA_TOKEN` — the Content token from Tokens
- `NEXT_PUBLIC_TINA_BRANCH` — the branch, usually `main`

### 12. Deploy to Vercel (or Netlify / Cloudflare Pages)

Vercel is the fastest path for an Astro + TinaCMS site. The starter ships `@astrojs/vercel` already configured.

1. Go to **https://vercel.com/new**, pick the GitHub repo.
2. Framework preset: **Astro** (auto-detected).
3. Before clicking **Deploy**, add Environment Variables:

   | Name | Value | Environments |
   |---|---|---|
   | `NEXT_PUBLIC_TINA_CLIENT_ID` | from TinaCloud Overview | Production, Preview, Development |
   | `TINA_TOKEN` | Content token from TinaCloud | Production, Preview, Development |
   | `NEXT_PUBLIC_TINA_BRANCH` | `main` | Production, Preview, Development |

4. **Project Settings → General → Node.js Version** — set to `22.x` (the Astro starter pins `>=22.22`; Vercel's current `22.x` LTS covers it).
5. Click **Deploy**. First build takes ~2 minutes.

Once the build is green, open the deploy URL. Two checks:

```bash
curl -sI https://<deploy-url>/           # public page: HTTP 200
curl -sI https://<deploy-url>/admin/     # editor shell: HTTP 200
```

Then open `https://<deploy-url>/admin/` in a browser. You'll be prompted to log in through TinaCloud — any user you've invited to the TinaCloud project can edit, and saves commit back to the GitHub repo on the branch you configured.

**Netlify / Cloudflare Pages:** same shape — pick the Astro preset, add the three env vars, deploy. The starter has adapters pre-installed for all three.

### 13. Share the preview URL

Send the deploy URL to the user. In the message include:

- The URL
- `yoursite.com/admin/` as the editing entry point
- Who can log in (anyone you add to the TinaCloud project)
- A note that this is a **preview**, not a replacement for the live site — production DNS stays on WordPress until the user says otherwise

### 14. Hand-off summary

Write a `MIGRATION-SUMMARY.md` in the project root listing:

- What was migrated (pages, posts, media counts)
- What was not migrated and why (shortcodes, specific plugins, forms, custom post types that need manual mapping)
- URLs that changed, with their redirects
- The command to start editing: `pnpm dev` + visit `/admin`
- Known risks before cut-over (e.g. active editors on the old site, forms not yet replaced)

**Do NOT point production DNS at the new site. That is the user's call.**

## When this path hits a wall

- The WP admin is locked behind SSO that the user can't fully control → fall back to `php-source.md` or `scraping.md`
- The exporter crashes on a huge XML file → split the export (`Export → Posts only`, then `Export → Pages only`)
- Custom post types are missing from the export → use the REST API directly (step 4 pattern) with the custom-type route (`/?rest_route=/wp/v2/<cpt>`)
- Content uses a page-builder (Elementor, Divi, WPBakery) → the exporter preserves raw HTML but it won't look right. Flag to the user; those pages typically need to be rebuilt in Astro components.

## Reference

- Existing manual guide: https://tina.io/docs/guides/converting-wordpress-to-tina
- `wordpress-export-to-markdown`: https://github.com/lonekorean/wordpress-export-to-markdown
- Astro + TinaCMS setup: https://tina.io/docs/frameworks/astro
