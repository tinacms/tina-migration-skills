# TinaCMS Migration Skills

AI assistant skills for migrating existing websites to [TinaCMS](https://tina.io). Primary focus: **WordPress**.

Each skill is a reusable, discoverable prompt that an AI assistant (Claude Code, Cursor, Copilot, etc.) can load to drive a specific migration path end-to-end — asking discovery questions first, then orchestrating the work.

## Status

Early. First skill — `migrate-wordpress-to-tinacms` — is in progress. See issue [tinacms/tina.io#4959](https://github.com/tinacms/tina.io/issues/4959) for scope and progress.

## Repository layout

```
tina-migration-skills/
├── README.md                                   # this file
├── LICENSE                                     # MIT
└── skills/
    ├── migrate-wordpress-to-tinacms/
    │   ├── SKILL.md                            # the skill prompt the AI loads
    │   ├── discovery.md                        # discovery questions asked up front
    │   ├── paths/
    │   │   ├── admin-access.md                 # primary path — fully worked
    │   │   ├── php-source.md                   # secondary — scaffolded
    │   │   └── scraping.md                     # secondary — scaffolded
    │   └── examples/
    │       └── <case-study>.md                 # worked examples from real migrations
    └── (future skills follow the same shape)
```

## Naming conventions

### Skill folder names

`migrate-<source>-to-tinacms`

- `migrate-wordpress-to-tinacms`
- `migrate-drupal-to-tinacms`
- `migrate-ghost-to-tinacms`

Always lowercase, kebab-case, explicit verb, `tinacms` as the destination (single word, no hyphen).

### Skill file structure

Every skill folder contains:

| File | Purpose |
|---|---|
| `SKILL.md` | The main prompt the AI loads. Describes the skill's purpose, when to use it, inputs, outputs, and sub-steps. |
| `discovery.md` | The questions the skill asks the user up front, before doing any work. See [Discovery first](#discovery-first). |
| `paths/<entry-point>.md` | One file per supported starting point (admin access, source-code access, scraping, etc.). |
| `examples/<case-study>.md` | Walkthroughs of real migrations run with this skill. |

### Repo name

`tina-<domain>-skills` for domain-specific skill collections (this repo is `tina-migration-skills`).

## Design principles

### One skill, multiple entry points

Prefer **one skill with branching paths** over many disconnected prompts. A single skill asks discovery questions, decides which entry-point path to follow, and keeps the user in one coherent conversation.

### Discovery first

Every skill opens with discovery questions — current platform, access to source / admin / files, authentication method, target framework (Next.js, Astro, etc.), hosting, timeline. The skill does not start modifying files until it has the answers it needs. Example questions live in each skill's `discovery.md`.

### Destination details

Migrated TinaCMS sites use `/admin` as the editor route (not `/wp-admin`). Document any other TinaCMS-specific destination conventions in each skill's `SKILL.md`.

### Portable prompts

Skills are written as plain Markdown so they can be used with:

- **Claude Code** — drop the skill folder into `.claude/skills/` and invoke by name
- **Cursor / Windsurf** — paste the `SKILL.md` into a rule file or chat
- **Any other AI assistant** — the Markdown is the prompt

## Using a skill with Claude Code

```bash
# From your project root:
mkdir -p .claude/skills
cp -R /path/to/tina-migration-skills/skills/migrate-wordpress-to-tinacms .claude/skills/
```

Then invoke it from Claude Code the same way you invoke any skill (`/migrate-wordpress-to-tinacms` or ask Claude to use it).

## Using a skill with other AI assistants

Open the skill's `SKILL.md` and paste its contents into your assistant's prompt / rules / system message. The skill will ask the same discovery questions and follow the same paths.

## Contributing

New migration skills and improvements welcome. Please open an issue to discuss scope before starting a large new skill. See [TinaCMS on Discord](https://tina.io/discord) for questions.

## License

MIT — see [LICENSE](LICENSE).
