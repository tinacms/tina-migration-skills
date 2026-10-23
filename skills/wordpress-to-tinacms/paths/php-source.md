# Path: PHP source / server access (secondary)

Use this path when the user has PHP source code or server access (SFTP / SSH / Git clone of the WP install) but no admin login.

**Status: scaffold.** This path is not yet fully worked. Fill in the TODOs during a real pilot of a server-access-only migration.

## When to use

- Agency / consultant inherited a client site with SFTP access but no admin credentials
- A legacy WP install where the admin is broken but files + database are accessible

## Shape of the work

1. **Pull the uploads folder** — straight copy from `wp-content/uploads/` into `public/uploads/` on the new site. This is almost always safe.
2. **Dump the database** — `wp-config.php` has the credentials. Export with `mysqldump` from the host or over SSH.
3. **Extract content from the SQL dump** — the `wp_posts` table holds pages + posts; `wp_postmeta` holds custom fields.
   - TODO: document the exact query to get publishable posts (`post_status = 'publish'`), including join to `wp_term_relationships` for categories/tags.
4. **Convert the HTML content to Markdown** — pipe through `turndown` or similar. TODO: pick and document one tool.
5. **Reconstruct the content tree** — pages → `src/content/pages/`, posts → `src/content/posts/`. Use the slug column.
6. **The rest of the admin-access path applies** — schema, routes, redirects, deploy. Jump to step 6 of `admin-access.md`.

## Why this path is harder

- No clean export — raw SQL means hand-crafting the query to get what you want
- Post meta is a 1-to-many table; custom fields have to be joined and interpreted
- Author / user mapping is in `wp_users` — easy to lose attribution

## TODOs for the first real pilot

- [ ] Document the standard SQL dump command for WP Engine / Kinsta / shared hosts
- [ ] Provide a reference SQL query that produces a usable export
- [ ] Pick a HTML → Markdown converter and document its edge cases
- [ ] Confirm whether reading the live `wp-content/plugins/` folder is useful for understanding what the site needs replaced
