#!/usr/bin/env bash
# Start the local WordPress test site and seed it. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")"

URL="http://localhost:8080"
wp() { docker compose run --rm -T cli wp "$@"; }

docker compose up -d --wait

echo "Waiting for WordPress files…"
until docker compose exec -T wordpress test -f /var/www/html/wp-config.php; do sleep 2; done

if ! wp core is-installed 2>/dev/null; then
  wp core install --url="$URL" --title="Tina WP Test Site" \
    --admin_user=admin --admin_password=tina-test-only \
    --admin_email=admin@example.test --skip-email
fi

wp rewrite structure '/%postname%/' # the image already ships a WordPress .htaccess
wp plugin install advanced-custom-fields wordpress-seo --activate
wp eval-file /seed/seed.php

cat <<EOF

Test site ready: $URL/wp-admin  (admin / tina-test-only)
EOF
