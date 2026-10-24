# TinaCMS Migration Skills

AI assistant skills for migrating existing websites to [TinaCMS](https://tina.io). Primary focus: **WordPress**.

Each skill is a reusable, discoverable prompt that an AI assistant (Claude Code, Cursor, Copilot, etc.) can load to drive a specific migration path end-to-end — asking discovery questions first, then orchestrating the work.

## Status

Early. First skill — `wordpress-to-tinacms` — is in progress. See issue [tinacms/tina.io#4959](https://github.com/tinacms/tina.io/issues/4959) for scope and progress.

## Repository layout

```
tina-migration-skills/
├── README.md                                   # this file
├── LICENSE                                     # MIT
└── skills/
    ├── wordpress-to-tinacms/
    │   ├── SKILL.md                            # orchestrator prompt the AI loads
    │   ├── discovery.md                        # questions asked up front
    │   ├── admin-tour.md                       # how the schema is derived from /wp-admin
    │   ├── schema-mapping.md                   # WP field type → Tina field type reference
    │   ├── scripts/
    │   │   └── wp-admin-tour.ts                # reference Playwright script
    │   └── examples/
    │       └── <case-study>.md                 # worked examples from real migrations
    └── (future skills follow the same shape)
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
| `discovery.md` | The questions the skill asks the user up front, before doing any work. See [Discovery first](#discovery-first). |
| `admin-tour.md` *(or similar)* | How the skill derives its target schema from the source — observation of the source CMS's editor, not scraping or exports. |
| `schema-mapping.md` | Reference table — source field types → TinaCMS field types. |
| `scripts/*.ts` | Reference automation scripts (Playwright tours, transformers). |
| `examples/<case-study>.md` | Walkthroughs of real migrations run with this skill. |

### Repo name

`tina-<domain>-skills` for domain-specific skill collections (this repo is `tina-migration-skills`).

## Design principles

### Observe the source editor, don't guess

The goal of a migration isn't just to move the content — it's to give editors a CMS that feels like the one they already know. Each skill derives its target TinaCMS schema from the source CMS's editor itself (for WordPress: a Playwright tour of `/wp-admin`). Field names, groupings, and types mirror what editors see today. This is the heart of each skill — not the content transformation.

### Local-first delivery

Skills produce a **working local project** — `yarn dev` runs it, `localhost:4321/admin` is the editor. TinaCloud, hosting, DNS, and SEO cutover are deliberately out of scope. Those are decisions the team makes separately once they're happy with the local pilot.

### Discovery first

Every skill opens with discovery questions — source URL, admin credentials (stored only in `.env.local`), target framework (Astro by default), scope boundaries. The skill does not start modifying files until it has the answers it needs. Example questions live in each skill's `discovery.md`.

### Destination details

Migrated TinaCMS sites use `/admin` as the editor route (not `/wp-admin`). Document any other TinaCMS-specific destination conventions in each skill's `SKILL.md`.

### Default frontend: Astro

Skills default to [Astro](https://astro.build/) as the target frontend. [TinaCMS has made Astro its default starter](https://tina.io/blog/astro-is-becoming-the-default-tinacms-starter), and Astro's content-first, zero-JS-by-default model fits the kind of sites typically migrated off WordPress (blogs, agency sites, business brochures, portfolios).

The discovery questions include a check for cases where [Next.js](https://nextjs.org/) is the better target:

- user accounts or auth beyond read-only
- server-rendered dashboards or admin-like features
- a heavy React component library the team already owns
- e-commerce with cart / checkout

If a skill picks Next.js, it should say so explicitly and explain why in its output, so the user knows an escape hatch was taken.

### Portable prompts

Skills are written as plain Markdown so they can be used with:

- **Claude Code** — drop the skill folder into `.claude/skills/` and invoke by name
- **Cursor / Windsurf** — paste the `SKILL.md` into a rule file or chat
- **Any other AI assistant** — the Markdown is the prompt

## Using a skill with Claude Code

```bash
# From your project root:
mkdir -p .claude/skills
cp -R /path/to/tina-migration-skills/skills/wordpress-to-tinacms .claude/skills/
```

Then invoke it from Claude Code the same way you invoke any skill (`/wordpress-to-tinacms` or ask Claude to use it).

## Using a skill with other AI assistants

Open the skill's `SKILL.md` and paste its contents into your assistant's prompt / rules / system message. The skill will ask the same discovery questions and follow the same paths.

## Contributing

New migration skills and improvements welcome. Please open an issue to discuss scope before starting a large new skill. See [TinaCMS on Discord](https://tina.io/discord) for questions.

## License

MIT — see [LICENSE](LICENSE).
