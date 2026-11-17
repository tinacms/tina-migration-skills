# Case study: local WordPress test site (full run)

The first end-to-end run of the skill, following `SKILL.md` step by step against [`test-sites/wordpress`](../../../test-sites/wordpress/). Unlike the [81military pilot](81military-com-au.md), the schema here was **observed** by the admin tour, not projected from an export.

## Source site

| | |
|---|---|
| WordPress | 7.1.3, permalinks `/%postname%/`, static front page ("Home") + posts page ("News") |
| Plugins | ACF 6.8.10 (free), Yoast SEO 28.7 |
| Post types | `post`, `page` (block editor), `event` (block editor CPT), `team_member` (classic-editor CPT, no body) |
| Taxonomies | `category`, `post_tag`, `event_type` (hierarchical, custom) |
| ACF groups | Event Details (on `event`), Profile (on `team_member`), Page Hero (on `page`) |
| Content | 3 posts + 1 draft, 5 pages + 1 draft, 2 events, 2 team members, 1 image, a 4-item menu |

## What the tour observed

All 4 post types, 3 taxonomies and 3 ACF groups were found. Yoast's metabox was on every post type, so each got an `seo` object. Nothing ended up in `unmapped`. One field was skipped on purpose: "Kiosk PIN" (an ACF password field). Full output: [`expected-schema.json`](../../../test-sites/wordpress/expected-schema.json).

The `event` editor in WordPress vs TinaCMS:

| WordPress (`/wp-admin`) | TinaCMS (`/admin`) |
|---|---|
| Title, Excerpt, Featured image panels | Title, Excerpt, Featured Image |
| Event Types checkbox tree | Event Types list (references to `event_type`) |
| **Event Details** ACF metabox, with Details / Agenda tabs | **Event Details** panel: Starts, Format (select with the same labels), Venue (with ACF's instructions as help text), Location (nested group), Ticket URL, Price, Free event, Speakers (references to Team), Agenda (rich text) |
| Yoast SEO metabox | SEO panel: title, description, canonical, social image, noindex |
| Block editor content | Content (rich text) |

ACF tabs are layout only, so they're dropped and the fields sit in one panel.

## Result

| | |
|---|---|
| Collections generated | 7: `post`, `page`, `event`, `team_member`, `category`, `tag`, `event_type` |
| Entries migrated | 3 posts, 5 pages, 2 events, 2 team members, 8 terms, 1 media file. Drafts skipped (2) |
| URLs | Every migrated URL matches its WordPress permalink. 0 redirects needed. `/home/` → `/` like WordPress |
| Build | `pnpm run build:local`: 23 pages, `astro check` 0 errors |
| Editor round trip | Edited Event Details → Venue in `/admin`, saved. The MDX file and the public page both updated |

## What broke, and what changed in the skill

1. **No generator or transformer existed.** Steps 4 and 8 were prose for the AI to improvise. They're now `generate-collections.ts` and `transform-content.ts`. They are repeatable and use each field's `source` from the tour, so ACF values land in the right group, serialized arrays are decoded and relationships become references.
2. **The Astro starter changed.** It now reads content through Tina's GraphQL client, not Astro content collections, and it's wired to demo `page`/`blog` collections (block-based pages, islands, RSS). Old step 7 ("update `src/content.config.ts`") was wrong. The skill now swaps the demo model for `templates/astro/`, which has one generic route that serves WordPress URLs.
3. **pnpm blocks the install** on `workerd`'s build script. Documented: set `workerd: false`.
4. **The front page needs Settings → Reading,** which the export doesn't carry. The tour now reads Settings → General / Permalinks / Reading.
5. **ACF true/false saves an unticked box as `''`.** The transformer maps it to `false` instead of dropping it.
6. **List items showed "Event Types Item".** The generator now adds `itemProps` so lists show the term or first text field.
7. **`migration/` must be gitignored before anything goes in it.** A premature `git add -A` in this run committed `.env.local` (dummy credentials) to the local pilot history, which had to be rewritten. `SKILL.md` now adds the ignore rule right after scaffolding.

## One-prompt run (plugin 0.2.0)

A fresh agent, with no other context, got this prompt in an empty folder:

> Migrate http://localhost:8080 from WordPress to TinaCMS

A script played the site owner. It filled in `migration/.env.local` 20 seconds after the file appeared.

| | |
|---|---|
| Pauses | **1**: waiting for the credentials file. No questions asked |
| Time | About 6½ minutes from prompt to running site, including scaffolding, installs, the tour and the build |
| Result | Same counts as above. `check-site.ts`: 13/13 URLs OK. `pnpm dev` left running |
| Summary | `MIGRATION-SUMMARY.md` with **Needs a decision**: the skipped Kiosk PIN, 1 approved comment, 2 skipped drafts. Then a six-step **Going live** checklist |
| Credentials | Never in the chat or the logs. `migration/.env.local` is gitignored |

The agent's notes led to three fixes:

- the project folder name drops a port
- `create-tina-app` already installs dependencies, and can hit the `workerd` snag
- that snag isn't specific to pnpm 11

Also tested in this round:

- **`--from-export`** on this site's export: the schema matches the observed one, except what an export can't show (a featured image nobody has set yet, the "Team" menu label). Generate, transform and build all pass on it.
- **Redirects:** with posts moved under `/blog/`, the old URLs answered `301` to the new ones, and `check-site.ts` covered all 16 URLs.

## Still open

- Visual (click-to-edit) editing for migrated entries. They're edited through the `/admin` form; only the header and footer are click-to-edit.
- ACF Pro types (repeater, flexible content, gallery, clone) and Rank Math are mapped but untested.
- ACF date-time values have no timezone in WordPress. They're stored as UTC.
- A real hosted site (WAF, 2FA, managed hosting).
