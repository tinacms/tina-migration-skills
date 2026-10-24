# Discovery questions

Short — the skill derives most of what it needs from `/wp-admin` directly. These questions cover what the admin tour can't answer and what the user must decide.

## 1. The source WordPress site

1. **URL** — public URL of the site, e.g. `https://example.com`
2. **Admin URL** — usually `<url>/wp-admin`, sometimes relocated (`/login`, `/manage`)
3. **Credentials** — written only to `migration/.env.local` (gitignored), never to chat. See the credentials block in `SKILL.md` step 1.
4. **2FA / SSO** — any extra auth step beyond username + password? If yes, agree on how to get past it headlessly, or run headed.

## 2. The target local project

5. **Target directory** — where should the new project live locally? Default: a sibling of the current WP checkout.
6. **Target framework** — Astro (default) or Next.js. Switch to Next.js only if the user confirms any of:
   - User accounts beyond read-only
   - Logged-in dashboards or admin-like features
   - Server-rendered personalized pages
   - Cart / checkout
   - A heavy React component library the team already owns

## 3. Scope boundaries

7. **Drafts** — migrate as drafts, as published, or skip entirely? Default: skip (common WordPress sites have a leftover default "Privacy Policy" draft nobody wants).
8. **Trashed items** — migrate, skip, or restore? Default: skip.
9. **Custom plugins extending the editor** — ACF, Yoast, Rank Math, CPT UI, Pods, etc. The admin tour discovers these automatically, but it helps to know up front which are in use so the schema mapping can be verified.
10. **Explicitly out of scope** — forms, e-commerce, membership, comments, search. Confirm these aren't expected.

## 4. Operational

11. **Content freeze** — anyone editing the WordPress site during migration? If yes, agree a freeze window or plan a delta migration.
12. **URL preservation** — keep existing URLs? Default: yes.

## Record

Write the answers to `migration/context.md` in the new project directory. The admin-tour script and later steps reference this file.
