# /wp-admin tour — how the schema is derived

The admin tour is what makes this skill valuable: instead of guessing at the target schema, the skill observes the live WordPress editor and generates a TinaCMS schema that mirrors it.

Driven by Playwright. Reference implementation in `scripts/wp-admin-tour.ts`.

## What the tour does

For a given `/wp-admin` login, in order:

1. **Login and access check.** Fill in `wp-login.php` with the credentials from `.env.local`. Fail fast on `#login_error`, a missing admin menu (WAF/SSO), or an account that can't open Plugins, Tools → Export and Settings (not an Administrator). `--check` stops here and writes nothing, so run it before setting up anything else.
2. **Read site settings.** The site title and tagline (Settings → General), the permalink structure (Settings → Permalinks), and whether the homepage is the latest posts or a static page, plus which page is the posts page (Settings → Reading). The export doesn't include these, and the routes need them. Forms are read, never submitted.
3. **Detect plugins** from **Plugins → Active**: ACF (free or Pro), Yoast SEO, Rank Math. The full active-plugin slug list goes into the manifest too.
4. **Enumerate post types** from the top-level admin menu (`edit.php?post_type=…` links). WordPress and ACF internals (`attachment`, `wp_block`, `acf-field-group`, …) are skipped.
5. **Read ACF field groups**, if ACF is active. The tour opens **ACF → Tools**, ticks every field group, clicks **Export As JSON** and saves the result to `migration/acf-field-groups.json`. This is the same file an admin would download by hand, and it's the precise, typed definition of every field, including nested groups and choice labels.
6. **For each post type**, open the **Add New** screen and read it:
   - **Block editor:** ask the editor's own data store (`wp.data`) which features the post type supports (`title`, `editor`, `excerpt`, `thumbnail`) and which taxonomies it uses. These are exactly the panels the editor decides to show.
   - **Classic editor:** read the form. `#title`, `#postdivrich`, `#postexcerpt`, `#postimagediv` and the taxonomy metaboxes.
   - **Metaboxes** (both editors) are listed by `id`. ACF groups render as `#acf-<group key>`, Yoast as `#wpseo_meta`.
7. **Build the fields** using `schema-mapping.md`:
   - Title, publish date, excerpt, featured image, then taxonomies (as reference lists).
   - **One Tina `object` per ACF field group** shown on that screen, named after the group (`Event Details` → `event_details`). Editors see the same panel in TinaCMS that they see in WordPress. Tabs, accordions and messages are layout-only and are dropped. Password, user and clone fields are skipped and logged.
   - **Yoast / Rank Math:** if the SEO metabox is on the screen, a single `seo` object (title, description, canonical, social image, noindex).
   - Body (`rich-text`) last, if the post type has the content editor.
   - Any other non-core metabox goes into the post type's **`unmapped`** list, so a human can decide. The tour doesn't invent a field for it.
8. **Emit `migration/schema.json`**. See the format below.
9. **Trigger content export.** Click **Tools → Export → All content → Download Export File** and save to `migration/wp-export.xml`.

### `schema.json` format

Trimmed from a real run against `test-sites/wordpress` (full output: [`expected-schema.json`](../../test-sites/wordpress/expected-schema.json)):

```json
{
  "siteUrl": "http://localhost:8080",
  "wpVersion": "7.1.3",
  "site": { "title": "Tina WP Test Site", "tagline": "", "permalinkStructure": "/%postname%/", "frontPage": { "show": "page", "pageId": 44, "postsPageId": 45 } },
  "postTypes": [
    {
      "name": "event",
      "label": "Events",
      "editor": "block",
      "fields": [
        { "type": "string", "name": "title", "label": "Title", "isTitle": true, "required": true, "source": { "kind": "core", "wpField": "post_title" } },
        { "type": "datetime", "name": "date", "label": "Publish date", "source": { "kind": "core", "wpField": "post_date" } },
        {
          "type": "object", "name": "event_type", "label": "Event Types", "list": true,
          "fields": [{ "type": "reference", "name": "item", "label": "Event Type", "collections": ["event_type"] }],
          "source": { "kind": "taxonomy", "taxonomy": "event_type" }
        },
        {
          "type": "object", "name": "event_details", "label": "Event Details",
          "source": { "kind": "acf-group", "key": "group_tina_event_details" },
          "fields": [
            { "name": "format", "label": "Format", "type": "string",
              "options": [{ "value": "in-person", "label": "In person" }, { "value": "online", "label": "Online" }, { "value": "hybrid", "label": "Hybrid" }],
              "source": { "kind": "acf", "key": "field_tina_event_format", "metaKey": "format", "acfType": "select" } }
          ]
        },
        { "type": "object", "name": "seo", "label": "SEO", "source": { "kind": "seo", "plugin": "yoast" }, "fields": ["…"] },
        { "type": "rich-text", "name": "body", "label": "Content", "source": { "kind": "core", "wpField": "post_content" } }
      ],
      "unmapped": []
    }
  ],
  "taxonomies": [{ "name": "event_type", "label": "Event Types", "hierarchical": true, "postTypes": ["event"] }],
  "plugins": { "acf": true, "yoast": true, "rankMath": false, "active": ["advanced-custom-fields", "wordpress-seo"] }
}
```

`source` is not part of the Tina schema. It records where each value lives in WordPress, so the content transformer can find it in `wp-export.xml`. Strip it when writing `tina/collections/*.ts`.

## Headful vs headless

Default: `headless: true`. Fastest, no browser window popping up.

Switch to `headless: false` when:
- WordPress site has 2FA — user needs to complete it interactively
- WAF (Cloudflare, Sucuri, Wordfence) blocks headless Chromium — a headed browser with a real user-agent sometimes gets through
- Debugging — watching the automation makes it easier to spot where it breaks

## What the tour does NOT do

- **Does not infer schema from the frontend.** The admin derives from the editor UI, not from how posts render publicly. Fields hidden from frontend but present in the editor still get included.
- **Does not copy the WP admin's look or workflow.** Just the schema. Draft/publish states, revisions, scheduled posts, media library layout, user roles — all out of scope for v1 (see `discovery.md` step 10).
- **Does not install any plugins or modify the WordPress site.** Read-only observation plus the standard Export buttons. Opening an Add-New screen creates an empty auto-draft, which WordPress deletes on its own after 7 days. It never shows up in the post lists.

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
| `this account can't open plugins.php …` | The account isn't an Administrator (e.g. Editor) | Ask for an Administrator account. Editors can't see Plugins, Export or Settings |
| Login succeeds but Add New screens 404 | Permalinks not set to pretty URLs | Use the `?post_type=<slug>&p=new` fallback URL |
| `ACF is active but the export tool lists no field groups` | Field groups registered in PHP (`acf_add_local_field_group`) or only in the theme's `acf-json/` folder | Ask the user for the theme's `acf-json/` folder (same JSON format) and drop the files into `migration/acf-field-groups.json` |
| A metabox appears under `unmapped` | A plugin or theme added fields the tour doesn't know | Ask the user what it holds. If it matters, add a detection block (below) |
| Export download hangs | Some hosts rate-limit anonymous downloads | Fall back: user clicks Tools → Export manually, drops XML into `migration/` |

## Testing changes to the tour

Use the local test site in [`test-sites/wordpress`](../../test-sites/wordpress/). It runs WordPress with ACF and Yoast in Docker and seeds a block-editor CPT, a classic-editor CPT, a custom taxonomy and three ACF field groups. Run the tour against it before and after every change.

## Reference

- `scripts/wp-admin-tour.ts` — the Playwright script itself
- `schema-mapping.md` — WP field type → Tina field type table used by the mapper
