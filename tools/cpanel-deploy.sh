#!/bin/bash
# Deploy this checkout to the website folder. cPanel runs it from .cpanel.yml when a deployment is started
# (Git Version Control → "Deploy HEAD Commit", or the GitHub "Deploy" workflow through the cPanel API).
# It can also be run by hand in cPanel → Terminal:  bash ~/repositories/garagio/tools/cpanel-deploy.sh
#
# Settings come from .deploy.env in the repository root on the server (git-ignored, written once by hand):
#   DEPLOY_PATH=/home/<cpaneluser>/trimurti.foreverstory.in     the subdomain's document root
#   PHP_BIN=/usr/local/bin/ea-php81                             PHP CLI (same version as the site)
#
# Steps: backup → copy public_html/ → database migrations → write api/storage/deploy.json (commit, time).
# Never deletes anything on the server and never touches api/config.php or uploaded photos / logs.
set -euo pipefail

cd "$(dirname "$0")/.."
REPO="$(pwd)"
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') deploy: $*"; }

if [ ! -f "$REPO/.deploy.env" ]; then
  log "missing $REPO/.deploy.env - see docs/DEPLOY.md (Automatic deploys)"; exit 1
fi
# Read KEY=VALUE lines without executing the file. Tolerates Windows line endings (cPanel's File Manager
# editor saves CRLF), blank lines, comments, spaces and quotes around values.
DEPLOY_PATH=""
PHP_BIN="php"
while IFS='=' read -r key value || [ -n "$key" ]; do
  key="$(printf '%s' "$key" | tr -d '\r[:space:]')"
  value="$(printf '%s' "${value:-}" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/")"
  case "$key" in
    DEPLOY_PATH) DEPLOY_PATH="$value" ;;
    PHP_BIN) [ -n "$value" ] && PHP_BIN="$value" ;;
  esac
done < "$REPO/.deploy.env"
[ -n "$DEPLOY_PATH" ] || { log "set DEPLOY_PATH in .deploy.env"; exit 1; }
DEPLOY_PATH="${DEPLOY_PATH%/}"

if [ -z "$DEPLOY_PATH" ] || [ "$DEPLOY_PATH" = "$HOME" ] || [ "$DEPLOY_PATH" = "/" ]; then
  log "DEPLOY_PATH '$DEPLOY_PATH' is not a website folder"; exit 1
fi
if [ ! -f "$DEPLOY_PATH/api/config.php" ]; then
  log "$DEPLOY_PATH/api/config.php not found. First install by hand (docs/DEPLOY.md steps 1-3), then deploy."; exit 1
fi

COMMIT="$(git rev-parse --short HEAD)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
log "commit $COMMIT ($BRANCH) → $DEPLOY_PATH"

# 1. Backup first (keeps the newest 14; a failed backup stops the deploy). Uses this checkout's script with
#    the site's config.php, so it works even before the site has the files (first automatic deploy).
GM_CONFIG="$DEPLOY_PATH/api/config.php" "$PHP_BIN" "$REPO/public_html/api/cron/backup.php"

# 2. Copy the site: exactly the committed files of public_html (git archive), never anything untracked or
#    git-ignored in this checkout. Files that exist only on the server (config.php, photos, logs, backups)
#    are left alone because nothing is deleted.
#    cPanel's MultiPHP Manager writes the site's PHP version into .htaccess between "# php -- BEGIN/END
#    cPanel-generated handler" lines. Our .htaccess replaces the file, so that block is carried over -
#    without it the site would silently fall back to another PHP version.
HT="$DEPLOY_PATH/.htaccess"
BEGIN_MARK='^# php -- BEGIN cPanel-generated handler'
END_MARK='^# php -- END cPanel-generated handler'
PHP_HANDLER=""
if [ -f "$HT" ]; then
  PHP_HANDLER="$(sed -n "/$BEGIN_MARK/,/$END_MARK/p" "$HT")"
fi
git archive --format=tar HEAD:public_html | tar -x -C "$DEPLOY_PATH"
if [ -n "$PHP_HANDLER" ] && ! grep -q "$BEGIN_MARK" "$HT"; then
  { printf '%s\n\n' "$PHP_HANDLER"; cat "$HT"; } > "$HT.deploy-tmp" && mv "$HT.deploy-tmp" "$HT"
  log "kept cPanel's PHP version block in .htaccess"
fi

# 3. Database changes that came with this commit.
"$PHP_BIN" "$DEPLOY_PATH/api/cron/migrate.php"

# 4. Record what is live; GET /api/public/info reports the commit so CI can confirm the deploy.
mkdir -p "$DEPLOY_PATH/api/storage"
printf '{"commit":"%s","branch":"%s","deployed_at":"%s"}\n' "$COMMIT" "$BRANCH" "$(date '+%Y-%m-%d %H:%M:%S')" > "$DEPLOY_PATH/api/storage/deploy.json"
log "done: $COMMIT is live"
