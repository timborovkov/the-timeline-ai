#!/usr/bin/env bash

set -euo pipefail

skill_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
scope="$skill_dir/scripts/review-scope.sh"
tmp=$(mktemp -d "${TMPDIR:-/tmp}/diff-review-tests.XXXXXX")
trap 'rm -rf "$tmp"' EXIT

assert_contains() {
  local output="$1"
  local expected="$2"
  [[ "$output" == *"$expected"* ]] || {
    printf 'expected output to contain: %s\n\n%s\n' "$expected" "$output" >&2
    exit 1
  }
}

commit_file() {
  local repo="$1"
  local content="$2"
  local message="$3"
  printf '%s\n' "$content" >"$repo/state.txt"
  git -C "$repo" add state.txt
  git -C "$repo" -c commit.gpgsign=false commit -q -m "$message"
}

remote="$tmp/remote.git"
seed="$tmp/seed"
git init -q --bare "$remote"
git init -q "$seed"
git -C "$seed" config user.name "Diff Review Test"
git -C "$seed" config user.email "diff-review@example.invalid"
commit_file "$seed" "base" "base"
git -C "$seed" branch -M main
git -C "$seed" remote add origin "$remote"
git -C "$seed" push -q -u origin main
git --git-dir="$remote" symbolic-ref HEAD refs/heads/main
base_commit=$(git -C "$seed" rev-parse HEAD)

# A fully qualified origin tracking ref must be normalized and refreshed.
canonical="$tmp/canonical"
git clone -q "$remote" "$canonical"
commit_file "$seed" "advanced" "advance main"
git -C "$seed" push -q origin main
advanced_commit=$(git -C "$seed" rev-parse HEAD)
git -C "$canonical" fetch -q origin "$advanced_commit"
git -C "$canonical" checkout -q -b feature FETCH_HEAD
[[ $(git -C "$canonical" rev-parse origin/main) == "$base_commit" ]]
canonical_output=$(cd "$canonical" && "$scope" --base refs/remotes/origin/main)
assert_contains "$canonical_output" "BASE_REF: origin/main"
assert_contains "$canonical_output" "FETCH_STATUS: updated origin/main"
assert_contains "$canonical_output" "MERGE_BASE: $advanced_commit"

# A non-origin remote with a symbolic HEAD must be selected automatically.
git -C "$seed" checkout -q -b release "$base_commit"
commit_file "$seed" "release" "release base"
git -C "$seed" push -q -u origin release
git --git-dir="$remote" symbolic-ref HEAD refs/heads/release
non_origin="$tmp/non-origin"
git clone -q -o upstream "$remote" "$non_origin"
non_origin_output=$(cd "$non_origin" && "$scope" --no-fetch)
assert_contains "$non_origin_output" "BASE_REF: upstream/release"
assert_contains "$non_origin_output" "BASE_SOURCE: symbolic refs/remotes/upstream/HEAD"

# If the local remote HEAD is absent, query the remote instead of guessing main.
custom_default="$tmp/custom-default"
git clone -q "$remote" "$custom_default"
git -C "$custom_default" symbolic-ref --delete refs/remotes/origin/HEAD
custom_output=$(cd "$custom_default" && "$scope")
assert_contains "$custom_output" "BASE_REF: origin/release"
assert_contains "$custom_output" "BASE_SOURCE: queried origin/HEAD"

# Fetch failure may use an already available tracking ref, with disclosure.
fallback="$tmp/fallback"
git clone -q "$remote" "$fallback"
git -C "$fallback" remote set-url origin "$tmp/missing.git"
fallback_output=$(cd "$fallback" && "$scope" --base origin/release 2>/dev/null)
assert_contains "$fallback_output" "FETCH_STATUS: failed; using existing origin/release"

# A repository without remotes may still use a local conventional default.
local_only="$tmp/local-only"
git init -q "$local_only"
git -C "$local_only" config user.name "Diff Review Test"
git -C "$local_only" config user.email "diff-review@example.invalid"
commit_file "$local_only" "local" "local base"
git -C "$local_only" branch -M main
local_output=$(cd "$local_only" && "$scope" --no-fetch)
assert_contains "$local_output" "BASE_REF: main"
assert_contains "$local_output" "BASE_SOURCE: local conventional branch"

printf 'review-scope tests passed\n'
