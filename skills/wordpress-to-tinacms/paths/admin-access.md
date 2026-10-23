# Path: WordPress admin access (primary)

Use this path when the user has a working `/wp-admin` login. It produces the cleanest migration.

## Prerequisites

- `migration-context.md` from the discovery step
- WordPress admin credentials
- Local Node.js 18+ and `pnpm` or `npm`
- A GitHub account with permission to create a repo

## Steps

### 1. Scaffold the new TinaCMS + Astro project

```bash
npx create-tina-app@latest
```

Pick the Astro template (unless discovery concluded Next.js — then pick that).

Open the new project and verify it starts:

```bash
cd <project>
pnpm install
pnpm dev
```

The site runs at `http://localhost:3000`, with the editor at `http://localhost:3000/admin`.

Commit this clean starter as the first commit. All subsequent migration work goes on branches.

### 2. Export WordPress content

In `/wp-admin`:

1. Go to **Tools → Export**
2. Choose **All content**
3. Download the resulting XML file. Rename it to `wp-export.xml`.

Save `wp-export.xml` in a `migration/` directory in the new project (gitignored).

### 3. Convert WordPress XML to Markdown

Use [`wordpress-export-to-markdown`](https://github.com/lonekorean/wordpress-export-to-markdown):

```bash
npx wordpress-export-to-markdown \
  --input migration/wp-export.xml \
  --output src/content/posts \
  --folder-mode post-folder \
  --save-images all
```

Options cheat sheet:

| Flag | Purpose |
|---|---|
| `--folder-mode post-folder` | One folder per post; keeps images beside their post |
| `--save-images all` | Downloads referenced images into each post folder |
| `--prefix-date true` | Prefixes filenames with the publish date (recommended for blogs) |

Review the output. The tool handles core WP content; it does **not** handle shortcodes, page-builder blocks, or custom post types — those come out as raw HTML in the Markdown body and need human attention.

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

If `wordpress-export-to-markdown` ran with `--save-images all`, images beside posts are already in `src/content/posts/<slug>/`.

For media referenced by pages (not posts), copy the `/wp-content/uploads/<year>/<month>/` folder into `public/uploads/` on the new site. Preserve the year/month structure so old URLs still resolve.

Verify no broken images:

```bash
grep -rE "src=['\"](http[s]?://|/wp-content)" src/content/ | head
```

Rewrite any remaining `https://<old-site>/wp-content/uploads/...` to `/uploads/...` with a `sed` pass.

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

### 8. Verify the `/admin` route

Run `pnpm dev` and open `http://localhost:3000/admin`. All collections should be editable. If a field is missing or shows raw HTML where rich-text is expected, revisit the schema.

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

### 10. Preview deploy

Push the repo to GitHub, connect it to the hosting target from discovery (Vercel / Netlify / Cloudflare Pages), and share the preview URL with the user.

### 11. Hand-off summary

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
