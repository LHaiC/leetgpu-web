#!/usr/bin/env bash
# Sync the challenge checkout from the upstream repository.
#
#   ./scripts/sync_challenges.sh [--dry-run] [--force] [DEST]
#
# DEST is the directory that holds the level folders (easy/ medium/ hard/) and
# core/, i.e. the value passed to `--challenges-dir`. Defaults to
# <repo>/upstream/leetgpu-challenges/challenges.
#
# The swap is atomic: the new tree is fully downloaded and validated in a temp
# directory, then swapped in with two renames. The previous tree is kept as
# DEST.bak-<timestamp> (only the newest backup is retained) so a bad sync can be
# rolled back by hand.
#
# Upstream content is CC BY-NC-ND 4.0 and is NOT redistributed by this project;
# this script only fetches it into a local, gitignored directory.
set -euo pipefail

REPO="AlphaGPU/leetgpu-challenges"
BRANCH="main"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEST_DEFAULT="$REPO_ROOT/upstream/leetgpu-challenges/challenges"

dry_run=false
force=false
dest=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=true ;;
    --force) force=true ;;
    -h|--help) sed -n '2,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *) dest="$arg" ;;
  esac
done

dest="${dest:-$DEST_DEFAULT}"
dest="$(cd "$(dirname "$dest")" 2>/dev/null && pwd)/$(basename "$dest")" || {
  echo "cannot resolve destination: $dest" >&2
  exit 2
}

count_challenges() {
  find "$1" -mindepth 3 -maxdepth 3 -name challenge.py -printf '.' 2>/dev/null | wc -c
}

list_challenges() {
  find "$1" -mindepth 3 -maxdepth 3 -name challenge.py 2>/dev/null \
    | sed "s|^$1/||; s|/challenge.py$||" | sort
}

echo "upstream : github.com/$REPO@$BRANCH"
echo "local    : $dest"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "downloading..."
if ! curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" | tar xz -C "$tmp"; then
  echo "download failed (network or upstream moved)" >&2
  exit 1
fi
src="$tmp/leetgpu-challenges-$BRANCH/challenges"
if [ ! -f "$src/core/challenge_base.py" ]; then
  echo "downloaded tree does not look like the challenge repository" >&2
  exit 1
fi
incoming="$(count_challenges "$src")"
if [ "$incoming" -lt 50 ]; then
  echo "refusing to sync: only $incoming challenges in the download" >&2
  exit 1
fi

if [ -d "$dest" ]; then
  current="$(count_challenges "$dest")"
  echo "challenges: local=$current upstream=$incoming"
  added="$(comm -13 <(list_challenges "$dest") <(list_challenges "$src") || true)"
  removed="$(comm -23 <(list_challenges "$dest") <(list_challenges "$src") || true)"
  if [ -n "$added" ]; then echo "new:"; echo "$added" | sed 's/^/  + /'; fi
  if [ -n "$removed" ]; then echo "gone upstream (kept in the backup):"; echo "$removed" | sed 's/^/  - /'; fi
  # Files the user added locally (e.g. their own solution/) are reported because
  # the swap replaces the whole tree.
  # Genuine local additions are files that exist here but not upstream (starter
  # files and everything else legitimately match, so compare sets, not names).
  extra="$(comm -23 \
      <(cd "$dest" && find . -type f -not -path '*__pycache__*' | sort) \
      <(cd "$src" && find . -type f | sort) | sed -n '1,20p')"
  if [ -n "$extra" ]; then
    echo "local-only files that the swap will drop (in the backup):"
    echo "$extra" | sed 's/^/  ! /'
    if [ "$force" = false ]; then
      echo "re-run with --force to proceed" >&2
      exit 3
    fi
  fi
else
  echo "challenges: local=(absent) upstream=$incoming"
fi

if [ "$dry_run" = true ]; then
  echo "dry run: nothing changed"
  exit 0
fi

mkdir -p "$(dirname "$dest")"
staged="$dest.new.$$"
rm -rf "$staged"
cp -a "$src" "$staged"

if [ -d "$dest" ]; then
  backup="$dest.bak-$(date +%Y%m%d-%H%M%S)"
  mv "$dest" "$backup"
  echo "backup   : $backup"
  # keep only the newest backup
  ls -1dt "$dest".bak-* 2>/dev/null | tail -n +2 | xargs -r rm -rf
fi
mv "$staged" "$dest"
echo "synced   : $dest ($incoming challenges)"
echo
echo "If the server is running, reload the catalog (admin panel -> 题库 -> 重载)"
echo "or restart it so the new challenges are served."
