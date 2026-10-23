# Path: Public scraping (last resort)

Use this path when the user has **only** the public site — no admin, no source. Expect lower fidelity than the other paths.

**Status: scaffold.** Not yet fully worked. Fill in the TODOs during a real pilot of a scrape-only migration.

## When to use

- The original developer is unreachable
- The hosting provider is lost
- The content is important enough to recover from the public site, but losing fidelity on styling and non-visible metadata is acceptable

## When NOT to use

- The site has member-only or logged-in content → that content won't be scraped
- The content has significant JS-rendering → a plain HTTP scrape won't see it

## Shape of the work

1. **Try the WordPress REST API first** — even without admin, `?rest_route=/wp/v2/pages` and `?rest_route=/wp/v2/posts` often return full content as JSON. If they do, this is almost as good as the admin path. Jump into the admin-access flow at step 4.
2. **If the REST API is closed**, crawl with a headless browser or `wget --mirror`. Preserve the directory structure for later redirect mapping.
3. **Extract main content** — strip chrome (header, nav, footer, sidebars) using a readability library (e.g. `@mozilla/readability`). TODO: pick one and document.
4. **Convert HTML → Markdown** — same tool choice as `php-source.md`.
5. **Media URLs** — download each `/wp-content/uploads/...` referenced in the HTML into `public/uploads/`, preserving the path.
6. **Rejoin the content tree** — slugs from URL paths, titles from `<h1>` or `<title>`, dates from `<time>` or structured data.
7. **Rest of admin-access.md applies** from step 6 onwards.

## What you lose

- Draft content, custom fields, author metadata, categories/tags not visible on-page
- Original markup for anything JS-rendered
- Exact publish dates for pages that don't display them

## TODOs for the first real pilot

- [ ] Pick a scraping tool: `wget --mirror`, `httrack`, Playwright, or Puppeteer
- [ ] Pick a HTML → Markdown converter and content extractor
- [ ] Document how to detect JS-rendered content before committing to this path
- [ ] Document a dry-run step that shows the user what will be scraped before downloading everything
