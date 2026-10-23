# Case study: 81military.com.au

A worked example of the `wordpress-to-tinacms` skill applied to [81military.com.au](https://81military.com.au/).

## Site profile (from discovery)

| Attribute | Value |
|---|---|
| Source URL | https://81military.com.au/ |
| Platform | WordPress 7.1.3 on **WP Engine** |
| Theme | Twenty Sixteen (default WordPress theme, unmodified) |
| Pages | 1 published (`Gateway Court`, slug `sample-page`) + 1 draft (`Privacy Policy`, default WP template) |
| Posts | 0 |
| Custom post types | None |
| Media items | 5 attachments: SSW-Sydney.jpg + 4 logo/favicon PNGs |
| Theme customization | 1 custom_css entry: `h2 {color:#cc4141;}` |
| Plugins visible on page source | `honeypot` (anti-spam only) |
| Page-builders | None (plain Gutenberg) |
| Forms | None |
| REST API | Open |

## Entry point used

**Admin access** — the user ran `Tools → Export → All content` in `/wp-admin` and provided the resulting `WordPress.xml` file.

## Target stack

- **Frontend:** Astro (default) — `tina-astro-starter` via `npx create-tina-app@latest`
- **Content storage:** TinaCMS content collections in the same Git repo
- **Editor backend:** TinaCloud (to configure)
- **Editor URL:** `/admin`

## Steps actually executed

1. **Copied `WordPress.xml` + downloaded media** into a local `migration/` workspace. Media URLs enumerated by `grep "<wp:attachment_url>"` in the XML and `curl`'d publicly (no auth needed).
2. **Scaffolded site:** `npx create-tina-app@latest 81military-site --template tina-astro-starter --pkg-manager pnpm`.
3. **Relaxed `engines.node`** in `package.json` from `>=22.22.0` to `>=22.14.0` — see "Lessons" below.
4. **Copied media** to `public/uploads/`.
5. **Transformed Gateway Court content** from Gutenberg block comments to a single `content` block in `src/content/page/gateway-court.mdx`. Rewrote image `src` from `https://81military.com.au/wp-content/uploads/.../SSW-Sydney.jpg` → `/uploads/SSW-Sydney.jpg`.
6. **Built** with `yarn build:local` → `/gateway-court/index.html` emitted. All 5 media files served from `/uploads/`.
7. **Committed** on branch `migration/wordpress-to-tinacms` of a local repo at `~/ClaudeCode/81military-site`.

## Output

| Artifact | Where |
|---|---|
| Astro + TinaCMS site | `~/ClaudeCode/81military-site` (local; not yet pushed to a GitHub repo) |
| Migrated page | `src/content/page/gateway-court.mdx` |
| Migrated media | `public/uploads/*.{jpg,png}` (5 files) |
| Preview URL | None yet — hosting target not chosen |

## Open items before cut-over

- [ ] Decision on the target GitHub repo (`SSWConsulting/81military-com-au` or similar)
- [ ] TinaCloud project set up (clientId, token, branch)
- [ ] Hosting target chosen + deployed (Vercel / Netlify / Cloudflare Pages)
- [ ] Redirect `/sample-page` → `/gateway-court` (and `/?page_id=2` → `/gateway-court`)
- [ ] Decision: keep or strip the starter's demo content (`about.mdx`, `home.mdx`, blog posts) before the final build
- [ ] Replace favicon with `cropped-ssw-squares.png` from the migrated media
- [ ] Apply the `h2 {color:#cc4141;}` style override somewhere, or decide it's no longer needed
- [ ] DNS cut-over at the user's call

## Lessons learned (fed back into the skill)

### 1. `wordpress-export-to-markdown` is wrong-first for page-only sites

The current admin-access path recommends `wordpress-export-to-markdown` as step 3. That tool is biased toward **posts** — for a page-only site like 81military it produces zero output. Fix: the skill should branch on content shape after discovery. If posts count = 0, skip that tool and go straight to the page-conversion step.

### 2. Media is already in the XML — no public downloads needed

The exported XML contains full `<wp:attachment_url>` entries. Extracting those with `grep` and downloading is cleaner than enumerating via the REST API. For sites behind auth where the API isn't open, the XML remains the ground truth.

### 3. Starter `engines.node` is stricter than Astro actually needs

The current `tina-astro-starter` pins `node >=22.22.0`. Builds succeed on 22.14+. Skill should check the user's Node version early, warn if below 22.22, and either (a) prompt to upgrade or (b) relax the engines field with a note in the migration summary.

### 4. The Astro starter uses a block-based page schema

Pages are composed of blocks (`hero`, `features`, `content`, etc.), not a single body field. Most WordPress pages map cleanly to one `content` block holding the markdown. More structured WP pages (hero image + feature grid + CTA) can be mapped to multiple blocks, but that's a hand-crafted decision per page.

### 5. Gutenberg block comments strip cleanly

The `<!-- wp:paragraph -->` / `<!-- /wp:paragraph -->` comments are safe to strip wholesale — the inner HTML/text is the content. The skill can regex-strip these before HTML → Markdown conversion.

### 6. The starter ships with demo content that will leak into the production build

`src/content/page/{home,about}.mdx` and `src/content/blog/*.mdx` ship with the Tina Astro starter. If left in, they appear in the live site. The skill should ask up front whether to strip them, and either delete them early or output a cleanup checklist at the end.

### 7. Heading-level semantics are a conversion decision

The source page used `h4` as a styled section-divider (centered) and `h2` for business names. A faithful conversion preserves this. A "semantic cleanup" conversion promotes dividers to proper heading levels. The skill should preserve by default and ask before cleaning up — document the trade-off either way in the migration summary.

### 8. The `custom_css` post type carries real styling

Export includes a `custom_css` post with `h2 {color:#cc4141;}`. The skill should surface these so the user can decide to port them into the new site's CSS, apply them site-wide, or drop them.
