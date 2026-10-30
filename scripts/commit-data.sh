#!/usr/bin/env bash
# Appends only this run's new CSV rows on top of the latest origin/main, then pushes.
# Avoids merge conflicts when the checkout is stale (e.g. re-run jobs) or another run pushed first.
set -euo pipefail

FILES=(docs/data/lighthouse.csv docs/data/crux.csv)
TMP=$(mktemp -d)

for file in "${FILES[@]}"; do
  [ -f "$file" ] || continue
  base=$( (git show "HEAD:$file" 2>/dev/null || true) | wc -l | tr -d ' ')
  tail -n +"$((base + 1))" "$file" > "$TMP/$(basename "$file").new"
  echo "$base" > "$TMP/$(basename "$file").base"
done

# Untracked copies would block the reset when upstream already has the file
rm -f "${FILES[@]}"

for attempt in 1 2 3; do
  git fetch origin main
  git reset --hard origin/main

  changed=0
  for file in "${FILES[@]}"; do
    new="$TMP/$(basename "$file").new"
    [ -s "$new" ] || continue
    if [ -f "$file" ] && [ "$(cat "$TMP/$(basename "$file").base")" = "0" ]; then
      # New rows include the header, which already exists upstream
      tail -n +2 "$new" >> "$file"
    else
      mkdir -p "$(dirname "$file")"
      cat "$new" >> "$file"
    fi
    git add "$file"
    changed=1
  done

  if [ "$changed" = "0" ] || git diff --staged --quiet; then
    echo "No new data to commit."
    exit 0
  fi

  git commit -m "Add performance data $(date -u '+%Y-%m-%d %H:%M') UTC"
  if git push; then
    exit 0
  fi
  echo "Push failed (attempt $attempt), retrying..."
  sleep 5
done

echo "Could not push results after 3 attempts." >&2
exit 1
