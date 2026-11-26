# Discovery: defaults, not questions

The skill runs from one prompt. The admin tour answers most of what a discovery call would, so use these defaults and **don't ask**. Write the ones you used into `migration/context.md`. If the user's prompt says otherwise for any of them, follow the prompt.

## Defaults

| Topic | Default | Notes |
|---|---|---|
| Site URL | From the prompt | The only thing to ask for if it's missing |
| Admin login URL | `<url>/wp-admin` | The tour needs WordPress's standard `/wp-login.php`. If a security plugin moved it, use the export fallback in `SKILL.md` |
| Credentials | An Administrator login in `migration/.env.local` | Never in chat. The user fills in the file once |
| 2FA / SSO | Not assumed | If the login check fails on 2FA, the user removes the `#` before `HEADLESS=false` and enters the code in the browser window |
| Project folder | `<host>-tinacms` in the current folder | `https://www.example.com` → `example-com-tinacms` |
| Framework | Astro (`tina-astro-starter`) | Never switch on your own. If the tour finds shop, membership or course plugins, say in the summary that their features need an app (Next.js or a service) |
| Drafts | Skipped | Re-run `transform-content.ts --drafts` to include them |
| Trashed items | Skipped | |
| Comments | Not migrated | Listed under **Needs a decision** if posts have them |
| Forms, search, shop, membership | Not migrated | Listed under **Needs a decision** when the plugin is active |
| URLs | Kept | Routes follow the WordPress permalinks. Any URL that changes gets a redirect |
| Content freeze | None for the local copy | The go-live checklist has a freeze-and-refresh step before switching the domain |

## When to ask anyway

Only at the stop points in `SKILL.md`: no URL, not WordPress, the credentials, a failed login check, a failed export, or a build you can't fix.

## Record

`migration/context.md` holds the site URL, the date, the defaults above, and anything the user overrode. It's committed with the project, so the team can see what the migration assumed.
