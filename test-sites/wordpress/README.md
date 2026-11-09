# WordPress test site

A disposable local WordPress for developing and testing the [`wordpress-to-tinacms`](../../skills/wordpress-to-tinacms/) skill. No client site or real credentials needed.

## What's in it

| | Editor | What it exercises |
|---|---|---|
| **Posts** | Block | Categories, tags, featured image, excerpt, Yoast SEO, one draft (should be skipped) |
| **Pages** | Block | ACF "Page Hero" group (text, textarea, link, image, colour picker), Yoast `noindex`, static front page ("Home") and posts page ("News") |
| **Events** (`event`) | Block | Custom post type + hierarchical custom taxonomy `event_type`, ACF "Event Details" group (date-time, select with labels, nested group, URL, number, true/false, relationship → Team, WYSIWYG, tabs) |
| **Team** (`team_member`) | Classic | No body field, ACF "Profile" group (message, required text, textarea, image, email, checkbox, date, password → should be skipped) |

Plus a "Main" menu (Home, About us, News, Events) and a post with an inline image, curly braces and inline code, which MDX is picky about.

Plugins: [ACF](https://wordpress.org/plugins/advanced-custom-fields/) (free) and [Yoast SEO](https://wordpress.org/plugins/wordpress-seo/), latest from wordpress.org. The post types live in [`mu-plugins/content-model.php`](mu-plugins/content-model.php). The ACF field groups are in [`seed/acf-field-groups.json`](seed/acf-field-groups.json), imported the same way ACF → Tools → Import does, so they behave like groups created in the UI.

## Run it

Needs Docker.

```bash
./setup.sh
```

Then open http://localhost:8080/wp-admin. The login is `admin` / `tina-test-only`. These are dummy credentials for this local container only.

`setup.sh` is safe to re-run. To start from scratch:

```bash
docker compose down -v
```

## Run the whole skill against it

Follow [`SKILL.md`](../../skills/wordpress-to-tinacms/SKILL.md) with `WP_ADMIN_URL=http://localhost:8080/wp-admin`. The [test-site case study](../../skills/wordpress-to-tinacms/examples/test-site.md) shows the expected results.

## Test just the admin tour

From an empty working directory:

```bash
mkdir -p migration
printf 'WP_ADMIN_URL=http://localhost:8080/wp-admin\nWP_USERNAME=admin\nWP_PASSWORD=tina-test-only\n' > migration/.env.local
cp /path/to/tina-migration-skills/skills/wordpress-to-tinacms/scripts/wp-admin-tour.ts migration/
npm init -y && npm i -D playwright dotenv @types/node typescript tsx && npx playwright install chromium
npx tsx migration/wp-admin-tour.ts
```

Compare the result with [`expected-schema.json`](expected-schema.json), ignoring `generatedAt`:

```bash
diff <(jq 'del(.generatedAt)' migration/schema.json) /path/to/tina-migration-skills/test-sites/wordpress/expected-schema.json
```

If you change the tour or the seed on purpose, regenerate `expected-schema.json` and commit it with the change.

## Not covered (yet)

- **ACF Pro** field types: repeater, flexible content, gallery, clone. These are mapped in the tour but untested, because ACF Pro isn't free to install.
- **Rank Math** — detection is written but untested.
- **Page builders** (Elementor, Divi, WPBakery).
