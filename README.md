# TinaCMS Migration Skills

AI assistant skills for migrating existing websites to [TinaCMS](https://tina.io). Primary focus: **WordPress**.

Each skill is a reusable, discoverable prompt that an AI assistant (Claude Code, Cursor, Copilot, etc.) can load to drive a specific migration path end to end, from one prompt with the site's URL to a running local site.

## Status

Early. First skill — `wordpress-to-tinacms` — is in progress. See issue [tinacms/tina.io#4959](https://github.com/tinacms/tina.io/issues/4959) for scope and progress.

## Quick start (Claude Code)

Install the plugin once, from inside Claude Code:

```
/plugin marketplace add tinacms/tina-migration-skills
/plugin install tina-migration@tinacms
```

Then, in an empty folder, ask for the migration:

```
/tina-migration:wordpress-to-tinacms https://example.com
```

Or just say *"Migrate example.com from WordPress to TinaCMS"*. Claude picks up the skill on its own.

Claude sets everything up and asks you for one thing: an Administrator login, put in a file it creates (never in the chat). It finishes with the site running at `http://localhost:4321`, the editor at `/admin`, and a `MIGRATION-SUMMARY.md` that ends with a checklist for going live.

New versions arrive when you run `/plugin marketplace update tinacms`, or on their own if you turn on auto-update for `tinacms` under **Marketplaces** in `/plugin`.

## Repository layout

```
tina-migration-skills/
├── README.md                                   # this file
├── LICENSE                                     # MIT
├── .claude-plugin/
│   ├── plugin.json                             # the repo is a Claude Code plugin ("tina-migration")…
│   └── marketplace.json                        # …and its own marketplace ("tinacms")
├── skills/
│   ├── wordpress-to-tinacms/
│   │   ├── SKILL.md                            # orchestrator prompt the AI loads
│   │   ├── discovery.md                        # defaults used instead of questions
│   │   ├── admin-tour.md                       # how the schema is derived from /wp-admin
│   │   ├── schema-mapping.md                   # WP field type → Tina field type reference
│   │   ├── scripts/
│   │   │   ├── wp-admin-tour.ts                # Playwright tour of /wp-admin → schema.json + export
│   │   │   ├── generate-collections.ts         # schema.json → tina/collections/*.ts
│   │   │   ├── transform-content.ts            # wp-export.xml → MDX/JSON content + media + redirects
│   │   │   └── check-site.ts                   # requests every migrated and redirected URL on the local site
│   │   ├── templates/astro/                    # generic Astro routes that replace the starter's demo model
│   │   └── examples/
│   │       └── <case-study>.md                 # worked examples from real migrations
│   └── (future skills follow the same shape)
└── test-sites/
    └── wordpress/                              # Docker WordPress + ACF + Yoast for testing the skill
```

## Naming conventions

### Skill folder names

`<source>-to-tinacms`

- `wordpress-to-tinacms`
- `drupal-to-tinacms`
- `ghost-to-tinacms`

Always lowercase, kebab-case, `tinacms` as the destination (single word, no hyphen).

### Skill file structure

Every skill folder contains:

| File | Purpose |
|---|---|
| `SKILL.md` | The main orchestrator prompt the AI loads. Describes the skill's purpose, when to use it, inputs, outputs, and sub-steps. |
| `discovery.md` | The defaults the skill uses instead of asking questions, and the few cases where it stops to ask. See [One prompt, sensible defaults](#one-prompt-sensible-defaults). |
| `admin-tour.md` *(or similar)* | How the skill derives its target schema from the source — observation of the source CMS's editor, not scraping or exports. |
| `schema-mapping.md` | Reference table — source field types → TinaCMS field types. |
| `scripts/*.ts` | Automation scripts (Playwright tours, generators, transformers). |
| `templates/<framework>/` | Files copied into the new project (routes, components, config). |
| `examples/<case-study>.md` | Walkthroughs of real migrations run with this skill. |

Where possible, a skill also gets a disposable local copy of the source CMS under `test-sites/<source>/`, so it can be tested without a client site or real credentials.

### Repo name

`tina-<domain>-skills` for domain-specific skill collections (this repo is `tina-migration-skills`).

## Design principles

### Observe the source editor, don't guess

The goal of a migration isn't just to move the content — it's to give editors a CMS that feels like the one they already know. Each skill derives its target TinaCMS schema from the source CMS's editor itself (for WordPress: a Playwright tour of `/wp-admin`). Field names, groupings, and types mirror what editors see today. This is the heart of each skill — not the content transformation.

### Local-first delivery

Skills produce a **working local project**, left running: `pnpm dev` serves it, `localhost:4321/admin` is the editor. They don't deploy. TinaCloud, hosting, DNS and SEO cutover are the team's decisions, so the skill ends with a go-live checklist instead of doing them.

### One prompt, sensible defaults

A migration starts from one prompt with the site's URL and runs to the end. Instead of asking discovery questions up front, a skill uses written defaults (each skill's `discovery.md`), records them in the project, and stops only when it can't go on without the user: credentials (kept in `.env.local`, never in chat), a failed login, or a failed export. Anything it can't migrate goes on a **Needs a decision** list in the summary instead of blocking the run.

### Destination details

Migrated TinaCMS sites use `/admin` as the editor route (not `/wp-admin`). Document any other TinaCMS-specific destination conventions in each skill's `SKILL.md`.

### Default frontend: Astro

Skills default to [Astro](https://astro.build/) as the target frontend. [TinaCMS has made Astro its default starter](https://tina.io/blog/astro-is-becoming-the-default-tinacms-starter), and Astro's content-first, zero-JS-by-default model fits the kind of sites typically migrated off WordPress (blogs, agency sites, business brochures, portfolios).

Some sites are better served by [Next.js](https://nextjs.org/) or an app service. Skills flag these in their summary instead of switching on their own:

- user accounts or auth beyond read-only
- server-rendered dashboards or admin-like features
- a heavy React component library the team already owns
- e-commerce with cart / checkout

The team decides. If a skill is asked to target Next.js, it should say so in its output, so the user knows an escape hatch was taken.

### Portable prompts

Skills are written as plain Markdown so they can be used with:

- **Claude Code** — install the plugin (see [Quick start](#quick-start-claude-code))
- **Cursor / Windsurf** — paste the `SKILL.md` into a rule file or chat
- **Any other AI assistant** — the Markdown is the prompt

## Using a skill with other AI assistants

Clone this repo and point your assistant at the skill's `SKILL.md`, or paste its contents into your assistant's prompt / rules / system message. Where it says `${CLAUDE_SKILL_DIR}`, use the path of the skill's folder in your clone, so the assistant can find the scripts and templates. The skill follows the same steps.

## Developing the plugin

Load your working copy instead of the published plugin:

```bash
claude --plugin-dir /path/to/tina-migration-skills
```

A running session keeps the skill text it loaded at startup. After editing `SKILL.md`, run `/reload-plugins` or start a new session before you test.

Check the manifests before you push:

```bash
claude plugin validate /path/to/tina-migration-skills
```

Bump `version` in [`.claude-plugin/plugin.json`](.claude-plugin/plugin.json) when you release. Installed copies stay on their version until it changes.

## Contributing

New migration skills and improvements welcome. Please open an issue to discuss scope before starting a large new skill. See [TinaCMS on Discord](https://tina.io/discord) for questions.

## License

MIT — see [LICENSE](LICENSE).
