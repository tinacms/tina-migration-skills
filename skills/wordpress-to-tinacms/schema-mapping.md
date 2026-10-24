# WordPress → TinaCMS field type mapping

Reference for the mapper step. For each WordPress editor control the admin tour discovers, use the mapping below to emit the corresponding TinaCMS field definition.

Keep field `name` identical to WordPress where possible so editors see the same labels in both tools.

## Core editor fields

| WordPress editor field | TinaCMS field | Notes |
|---|---|---|
| Title | `{ type: 'string', name: 'title', isTitle: true, required: true }` | Always present. `isTitle: true` makes it the collection's row title. |
| Content (block editor) | `{ type: 'rich-text', name: 'body', parser: { type: 'mdx' } }` | Gutenberg blocks lose their block identity; content comes out as semantic Markdown. |
| Content (classic editor) | `{ type: 'rich-text', name: 'body', parser: { type: 'mdx' } }` | Same target field; the transform step converts HTML to MDX. |
| Excerpt | `{ type: 'string', name: 'excerpt', ui: { component: 'textarea' } }` | Multi-line but plain text. |
| Permalink / Slug | *(filename)* | Tina uses the file name as the slug; no explicit field needed. |
| Publish date | `{ type: 'datetime', name: 'date' }` | |
| Author | `{ type: 'reference', name: 'author', collections: ['author'] }` | Only if the user maintains an authors collection; otherwise `{ type: 'string', name: 'author' }`. |
| Featured image | `{ type: 'image', name: 'featured_image' }` | Media library migrated to `public/uploads/`. |
| Status (publish/draft) | *(file location)* | Draft content either migrates to a `src/content/drafts/` folder or is skipped — user's choice in discovery. |
| Comments allowed | *(skip)* | Comments are out of scope for v1 (see discovery.md step 10). |

## Taxonomies

| WordPress | TinaCMS |
|---|---|
| Categories | New collection `category` with `{title, slug, description}`; on each post: `{ type: 'reference', name: 'categories', list: true, collections: ['category'] }` |
| Tags | Same shape as categories: new collection `tag`, posts get a list of references. |
| Custom taxonomy (hierarchical) | New collection with `{title, slug, description, parent?: reference}`; posts get a list of references. |
| Custom taxonomy (flat) | New collection with `{title, slug}`; posts get a list of references. |

If the taxonomy has very few values and never grows, a `{ type: 'string', list: true, options: [...] }` is simpler than a reference. Default to reference — options require re-generation each time a term is added.

## ACF (Advanced Custom Fields)

ACF's own types map directly to Tina:

| ACF type | TinaCMS field |
|---|---|
| Text | `{ type: 'string' }` |
| Textarea | `{ type: 'string', ui: { component: 'textarea' } }` |
| Number | `{ type: 'number' }` |
| Email | `{ type: 'string' }` (with `validate` for format if needed) |
| URL | `{ type: 'string' }` (with `validate`) |
| Password | *(skip — don't migrate secrets)* |
| Image | `{ type: 'image' }` |
| File | `{ type: 'image' }` (Tina's image field accepts any file) |
| WYSIWYG | `{ type: 'rich-text' }` |
| oEmbed | `{ type: 'string' }` — store the URL, render as embed at the frontend |
| Select | `{ type: 'string', options: [...] }` |
| Checkbox | `{ type: 'string', list: true, options: [...] }` |
| Radio | `{ type: 'string', options: [...] }` |
| True/False | `{ type: 'boolean' }` |
| Date Picker | `{ type: 'datetime' }` |
| Date Time Picker | `{ type: 'datetime' }` |
| Time Picker | `{ type: 'string' }` — Tina has no time-only type; store as `HH:MM`. |
| Color Picker | `{ type: 'string' }` — store the hex value. |
| Google Map | `{ type: 'object', fields: [{type:'number',name:'lat'},{type:'number',name:'lng'},{type:'string',name:'address'}] }` |
| Message | *(skip — editor-only hint, no data)* |
| Tab | *(skip — just a UI grouping)* |
| Accordion | *(skip — just a UI grouping)* |
| Group | `{ type: 'object', fields: [...] }` — recurse into the group's fields |
| Repeater | `{ type: 'object', list: true, fields: [...] }` — recurse |
| Flexible Content | `{ type: 'object', list: true, templates: [...] }` — one template per layout, recurse |
| Clone | *(resolve — treat the clone as if the referenced fields were inlined)* |
| Post Object | `{ type: 'reference', collections: [...] }` |
| Page Link | `{ type: 'reference', collections: [...] }` or `{ type: 'string' }` for external |
| Relationship | `{ type: 'reference', list: true, collections: [...] }` |
| Taxonomy | `{ type: 'reference', list: true, collections: ['category'] }` (or the specific taxonomy collection) |
| User | *(skip — user management out of scope)* |

## Yoast / Rank Math SEO

Collapse into a single `seo` object on each post type:

```ts
{
  type: 'object',
  name: 'seo',
  label: 'SEO',
  fields: [
    { type: 'string', name: 'title', label: 'SEO Title' },
    { type: 'string', name: 'description', label: 'Meta Description', ui: { component: 'textarea' } },
    { type: 'string', name: 'canonical', label: 'Canonical URL' },
    { type: 'image', name: 'og_image', label: 'Social Share Image' },
    { type: 'boolean', name: 'noindex', label: 'Hide from search engines' }
  ]
}
```

## Things not to migrate

- **User accounts / roles** — out of scope for v1.
- **Comments** — out of scope. If critical, Disqus or a static-comments plugin covers this on the Astro side.
- **Theme / page-builder presentation layer** — the schema migration is about *content shape*, not visual design. Templates and components get rewritten in Astro.
- **Admin-only metaboxes with no editor-facing use** — if a field is hidden from editors on the Edit screen, it's probably debug data and doesn't belong in the content schema.

## Edge cases to flag in the migration summary

- **ACF Flexible Content with many layouts** — generates one Tina template per layout, which can balloon the schema. If there are more than ~10 layouts, ask the user whether some are deprecated and can be dropped.
- **Serialized PHP in postmeta** — some older plugins store data as `serialize()` strings in `wp_postmeta`. The admin tour will see the field but can't parse the value. Flag and let the user decide: skip the field, write a one-off parser, or drop that post type from scope.
- **Multi-site WordPress** — out of scope. One site per migration run.
