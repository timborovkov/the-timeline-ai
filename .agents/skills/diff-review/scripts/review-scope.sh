#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: review-scope.sh [--base <git-ref>] [--no-fetch]

Resolve the default branch, merge base, and effective branch/worktree review
scope. The script never changes the working tree. By default it refreshes an
available configured-remote base ref and falls back to the existing ref on
fetch failure.
EOF
}

base_arg=""
fetch_base=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)
      [[ $# -ge 2 ]] || { echo "error: --base requires a git ref" >&2; exit 2; }
      base_arg="$2"
      shift 2
      ;;
    --no-fetch)
      fetch_base=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "error: not inside a Git repository" >&2
  exit 2
}
cd "$repo_root"

git rev-parse --verify HEAD^{commit} >/dev/null 2>&1 || {
  echo "error: repository has no HEAD commit to compare" >&2
  exit 2
}

current_branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)
if [[ -z "$current_branch" ]]; then
  current_branch="(detached HEAD at $(git rev-parse --short HEAD))"
fi

base_branch=""
base_ref=""
base_remote=""
base_source=""

remotes=()
while IFS= read -r remote; do
  [[ -n "$remote" ]] && remotes+=("$remote")
done < <(git remote)

ordered_remotes=()
if [[ ${#remotes[@]} -gt 0 ]]; then
  for preferred in origin upstream; do
    for remote in "${remotes[@]}"; do
      [[ "$remote" == "$preferred" ]] && ordered_remotes+=("$remote")
    done
  done
  for remote in "${remotes[@]}"; do
    [[ "$remote" == origin || "$remote" == upstream ]] || ordered_remotes+=("$remote")
  done
fi

classify_remote_ref() {
  local ref="$1"
  local remote

  if [[ ${#remotes[@]} -gt 0 ]]; then
    for remote in "${remotes[@]}"; do
      if [[ "$ref" == "$remote/"* ]]; then
        base_remote="$remote"
        base_branch=${ref#"$remote/"}
        base_ref="$remote/$base_branch"
        return 0
      fi
      if [[ "$ref" == "refs/remotes/$remote/"* ]]; then
        base_remote="$remote"
        base_branch=${ref#"refs/remotes/$remote/"}
        base_ref="$remote/$base_branch"
        return 0
      fi
    done
  fi

  return 1
}

select_remote_default() {
  local remote
  local remote_head

  if [[ ${#ordered_remotes[@]} -gt 0 ]]; then
    for remote in "${ordered_remotes[@]}"; do
      remote_head=$(git symbolic-ref --quiet --short "refs/remotes/$remote/HEAD" 2>/dev/null || true)
      if [[ -n "$remote_head" ]] && classify_remote_ref "$remote_head"; then
        base_source="symbolic refs/remotes/$remote/HEAD"
        return 0
      fi
    done
  fi

  [[ $fetch_base -eq 1 ]] || return 1

  if [[ ${#ordered_remotes[@]} -gt 0 ]]; then
    for remote in "${ordered_remotes[@]}"; do
      remote_head=$(
        git ls-remote --symref "$remote" HEAD 2>/dev/null |
          awk '$1 == "ref:" && $3 == "HEAD" {sub(/^refs\/heads\//, "", $2); print $2; exit}' || true
      )
      if [[ -n "$remote_head" ]]; then
        base_remote="$remote"
        base_branch="$remote_head"
        base_ref="$remote/$base_branch"
        base_source="queried $remote/HEAD"
        return 0
      fi
    done
  fi

  return 1
}

if [[ -n "$base_arg" ]]; then
  if classify_remote_ref "$base_arg"; then
    base_source="explicit remote ref"
  elif git rev-parse --verify --quiet "$base_arg^{commit}" >/dev/null; then
    base_ref="$base_arg"
    base_branch=${base_ref#refs/heads/}
    base_source="explicit local ref"
  elif [[ "$base_arg" != */* ]]; then
    if [[ ${#ordered_remotes[@]} -gt 0 ]]; then
      for remote in "${ordered_remotes[@]}"; do
        if git rev-parse --verify --quiet "$remote/$base_arg^{commit}" >/dev/null; then
          base_remote="$remote"
          base_branch="$base_arg"
          base_ref="$remote/$base_branch"
          base_source="explicit branch on $remote"
          break
        fi
      done
    fi
  fi
else
  select_remote_default || true
  if [[ -z "$base_ref" && ${#remotes[@]} -eq 0 ]]; then
    for candidate in main master trunk develop; do
      if git rev-parse --verify --quiet "$candidate^{commit}" >/dev/null; then
        base_ref="$candidate"
        base_branch="$candidate"
        base_source="local conventional branch"
        break
      fi
    done
  fi
fi

[[ -n "$base_ref" ]] || {
  if [[ -n "$base_arg" ]]; then
    echo "error: base ref does not resolve to a commit: $base_arg" >&2
  else
    echo "error: could not determine the repository default branch; pass --base <git-ref>" >&2
  fi
  exit 2
}

fetch_status="not requested"
if [[ $fetch_base -eq 1 && -n "$base_remote" ]]; then
  if git fetch --quiet "$base_remote" "+refs/heads/$base_branch:refs/remotes/$base_remote/$base_branch"; then
    fetch_status="updated $base_remote/$base_branch"
  elif git rev-parse --verify --quiet "$base_ref^{commit}" >/dev/null; then
    fetch_status="failed; using existing $base_ref"
  else
    echo "error: fetch failed and base ref is unavailable locally: $base_ref" >&2
    exit 2
  fi
elif [[ $fetch_base -eq 1 ]]; then
  fetch_status="skipped; base is local"
fi

git rev-parse --verify --quiet "$base_ref^{commit}" >/dev/null || {
  echo "error: base ref is unavailable locally: $base_ref" >&2
  exit 2
}

merge_base=$(git merge-base "$base_ref" HEAD 2>/dev/null) || {
  echo "error: $base_ref and HEAD have no merge base" >&2
  exit 2
}

committed_count=$(git diff --name-only "$merge_base" HEAD | awk 'NF {n++} END {print n+0}')
staged_count=$(git diff --cached --name-only | awk 'NF {n++} END {print n+0}')
unstaged_count=$(git diff --name-only | awk 'NF {n++} END {print n+0}')
untracked_count=$(git ls-files --others --exclude-standard | awk 'NF {n++} END {print n+0}')
tracked_effective_count=$(git diff --name-only "$merge_base" | awk 'NF {n++} END {print n+0}')
shortstat=$(git diff --shortstat "$merge_base" | sed 's/^[[:space:]]*//' || true)
[[ -n "$shortstat" ]] || shortstat="no tracked changes"

printf 'REPO_ROOT: %s\n' "$repo_root"
printf 'CURRENT_BRANCH: %s\n' "$current_branch"
printf 'BASE_BRANCH: %s\n' "$base_branch"
printf 'BASE_REF: %s\n' "$base_ref"
printf 'BASE_SOURCE: %s\n' "$base_source"
printf 'FETCH_STATUS: %s\n' "$fetch_status"
printf 'MERGE_BASE: %s\n' "$merge_base"
printf 'SCOPE: merge base through current worktree\n'
printf 'COVERAGE: committed + staged + unstaged tracked changes; untracked listed separately\n'
printf 'COUNTS: committed_paths=%s staged_paths=%s unstaged_paths=%s effective_tracked_paths=%s untracked_paths=%s\n' \
  "$committed_count" "$staged_count" "$unstaged_count" "$tracked_effective_count" "$untracked_count"
printf 'DIFFSTAT: %s\n' "$shortstat"

printf '\nCHANGED_PATHS:\n'
git diff --name-status "$merge_base"
git ls-files --others --exclude-standard | sed $'s/^/??\t/'

if [[ $tracked_effective_count -eq 0 && $untracked_count -eq 0 ]]; then
  printf '\nNOTHING_TO_REVIEW: true\n'
else
  printf '\nNOTHING_TO_REVIEW: false\n'
fi
