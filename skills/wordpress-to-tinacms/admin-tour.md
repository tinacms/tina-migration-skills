# /wp-admin tour — how the schema is derived

The admin tour is what makes this skill valuable: instead of guessing at the target schema, the skill observes the live WordPress editor and generates a TinaCMS schema that mirrors it.

Driven by Playwright. Reference implementation in `scripts/wp-admin-tour.ts`.

## What the tour does

For a given `/wp-admin` login, in order:

1. **Login** — POST to `wp-login.php` with the credentials from `.env.local`, confirm redirect to `/wp-admin/`.
2. **Enumerate post types** from the admin menu. Core: `post`, `page`, `attachment`. Custom: anything a plugin registered via `register_post_type()` (e.g. `event`, `product`, `team-member`, `case-study`).
3. **For each post type**: open the **Add New** screen and read the form:
   - **Title** input (always present) → Tina `string`, `isTitle: true`
   - **Content** editor (block editor or classic) → Tina `rich-text`
   - **Excerpt** panel → Tina `string` with `component: 'textarea'`
   - **Featured Image** panel → Tina `image`
   - **Categories / Tags / custom taxonomies** → Tina `reference` (if the collection exists) or `string` with `options`
   - **Custom field metaboxes** (anything a plugin added) → inspect the metabox HTML to pick the right Tina type
4. **Enumerate taxonomies** registered on each post type → generate a matching Tina collection for each custom taxonomy.
5. **Detect ACF (Advanced Custom Fields)** — if the plugin is present, read the ACF **Field Groups** admin page (`/wp-admin/edit.php?post_type=acf-field-group`) for a precise typed schema. ACF's manifest is far cleaner than scraping the Add-New screen.
6. **Detect Yoast / Rank Math SEO** — if present, their metabox fields become a Tina `seo` object (title, description, canonical, og image).
7. **Trigger content export** — click **Tools → Export → All content → Download Export File** and save to `migration/wp-export.xml`.
8. **Emit `migration/schema.json`** — the full manifest. Format:

   ```json
   {
     "generatedAt": "2026-10-23T...Z",
     "siteUrl": "https://example.com",
     "wpVersion": "7.1.3",
     "postTypes": [
       {
         "name": "post",
         "label": "Posts",
         "fields": [
           { "name": "title", "label": "Title", "type": "string", "isTitle": true },
           { "name": "content", "label": "Content", "type": "rich-text" },
           { "name": "excerpt", "label": "Excerpt", "type": "string", "ui": { "component": "textarea" } },
           { "name": "featured_image", "label": "Featured Image", "type": "image" },
           { "name": "categories", "label": "Categories", "type": "reference", "collections": ["category"] }
         ]
       }
     ],
     "taxonomies": [...],
     "plugins": { "acf": true, "yoast": true }
   }
   ```

## Headful vs headless

Default: `headless: true`. Fastest, no browser window popping up.

Switch to `headless: false` when:
- WordPress site has 2FA — user needs to complete it interactively
- WAF (Cloudflare, Sucuri, Wordfence) blocks headless Chromium — a headed browser with a real user-agent sometimes gets through
- Debugging — watching the automation makes it easier to spot where it breaks

## What the tour does NOT do

- **Does not infer schema from the frontend.** The admin derives from the editor UI, not from how posts render publicly. Fields hidden from frontend but present in the editor still get included.
- **Does not copy the WP admin's look or workflow.** Just the schema. Draft/publish states, revisions, scheduled posts, media library layout, user roles — all out of scope for v1 (see `discovery.md` step 10).
- **Does not install any plugins or modify the WordPress site.** Read-only observation plus the standard Export button.

## Extending for a specific plugin

If the user has a plugin whose metaboxes don't match any of the heuristics in the reference script, add a detection block to `wp-admin-tour.ts`:

1. Visit the plugin's admin page (common pattern: `/wp-admin/admin.php?page=<plugin-slug>`)
2. Scrape the field definitions
3. Map to Tina field types using `schema-mapping.md`
4. Append to the manifest under `postTypes[].fields` or a new top-level `pluginSchemas` block

Commit the new detection block back to this skill repo so the next migration benefits.

## When the tour fails

| Failure | Likely cause | Fix |
|---|---|---|
| `wp-login.php` returns 403 | WAF blocking headless Chromium | Switch to `headless: false` or add real user-agent |
| Login succeeds but Add New screens 404 | Permalinks not set to pretty URLs | Use the `?post_type=<slug>&p=new` fallback URL |
| ACF detection returns zero fields | ACF field groups stored externally (JSON files in theme) | Ask the user for the theme's `acf-json/` folder path and read field groups from there |
| Export download hangs | Some hosts rate-limit anonymous downloads | Fall back: user clicks Tools → Export manually, drops XML into `migration/` |

## Reference

- `scripts/wp-admin-tour.ts` — the Playwright script itself
- `schema-mapping.md` — WP field type → Tina field type table used by the mapper
