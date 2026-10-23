# Discovery questions

Ask these in order before touching any files. Record each answer. **Do not skip questions you don't have an answer to — ask the user.**

## 1. The current site

1. **What is the current site's URL?**
2. **Is it WordPress?** Verify with: `curl -sI <url>` (look for `x-powered-by: WP Engine` / `x-pingback: .../xmlrpc.php` / theme paths like `/wp-content/themes/`). If it isn't WordPress, stop and tell the user — this skill is WordPress-only.
3. **Which WordPress version?** Check the admin dashboard, the `generator` meta tag in page source, or the REST API root.
4. **Who hosts it?** (WP Engine, Kinsta, Flywheel, a VPS, shared hosting…)
5. **Is the WordPress REST API open?** Try `curl -s <url>/?rest_route=/wp/v2/pages`. If it returns JSON, admin-path export is usable. If it returns a 404 or empty, note it — admin-access path still works via the WordPress exporter UI.

## 2. What the user has access to

Ask explicitly — don't assume:

6. **Do you have a WordPress admin login?** (user+password, or an SSO account that leads to `/wp-admin`)
7. **Do you have access to the PHP source code / server?** (SFTP, SSH, Git clone of the WP install)
8. **Do you have none of the above — only the public site?**

Based on the first "yes":
- Admin login → use `paths/admin-access.md`
- PHP source only → use `paths/php-source.md`
- Public only → use `paths/scraping.md`

If the user has admin, prefer it even if they also have source. It's the cleanest export.

## 3. Content shape

9. **How many pages, posts, and other content types are on the site?** The REST API gives quick counts:
   - Pages: `<url>/?rest_route=/wp/v2/pages&per_page=1` (check `X-WP-Total` header)
   - Posts: `<url>/?rest_route=/wp/v2/posts&per_page=1`
   - If the API is closed, ask the user to log in and look at the dashboard.
10. **Any custom post types?** (events, products, team members, case studies…) Visible as top-level menu items in `/wp-admin`.
11. **How is media organized?** Rough count of images / videos / PDFs. Any CDN in front of the uploads folder?
12. **What plugins are active?** List them from `/wp-admin/plugins.php`. Each needs a decision: ignore / replace / out-of-scope.
13. **Any page-builders?** (Elementor, WPBakery, Divi, Gutenberg block patterns, custom shortcodes). These are the hardest to migrate automatically — flag early.
14. **Any forms?** (Contact Form 7, Gravity Forms, WPForms, Fluent Forms…) The target site needs a replacement; the skill does not migrate form submissions.

## 4. The new site

15. **Target frontend: Astro (default) or Next.js?** Pick Next.js only if the user confirms *any* of:
    - User accounts beyond read-only
    - Logged-in dashboards or admin-like features
    - Server-rendered personalized pages
    - Cart / checkout
    - A heavy React component library the team already owns
16. **Where will the new site be hosted?** Vercel / Netlify / Cloudflare Pages / self-hosted.
17. **TinaCMS editor backend: TinaCloud or self-hosted?** Default to TinaCloud for new users. Flag TinaCloud's free-tier limits.
18. **Should content live in the same Git repo as the code, or a separate content repo?** Default: same repo. Use a separate content repo if a non-dev content team needs an independent approval workflow.
19. **Preserve existing URLs?** Default: yes. Ask for exceptions.

## 5. Timing + scope

20. **Is anyone editing the WordPress site actively during this migration?** If yes, agree on a content freeze or plan a delta migration.
21. **Is there a cut-over date, or is this exploratory?**
22. **What is explicitly out of scope?** Styling fidelity, forms, e-commerce, membership, search — surface each one and ask.

## Record the answers

Before leaving discovery, write the answers into a `migration-context.md` file in the new project root. The paths/*.md files reference this file.
