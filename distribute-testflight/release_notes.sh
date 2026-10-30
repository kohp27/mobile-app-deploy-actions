#!/bin/bash
set -euo pipefail

workflow_file=$(basename "${GITHUB_WORKFLOW_REF%@*}")
previous_sha=$(gh api "repos/$GITHUB_REPOSITORY/actions/workflows/$workflow_file/runs?branch=$GITHUB_REF_NAME&status=success&per_page=1" --jq '.workflow_runs[0].head_sha // empty')

if [ -n "$previous_sha" ] && git merge-base --is-ancestor "$previous_sha" HEAD 2>/dev/null; then
  log_args=("$previous_sha..HEAD")
else
  log_args=(-1 HEAD)
fi

describe() {
  local subject="$1" branch pr_number title

  pr_number=$(sed -nE 's/^Merge pull request #([0-9]+) from .*/\1/p' <<<"$subject")
  if [ -n "$pr_number" ]; then
    title=$(gh pr view "$pr_number" --json title --jq '.title' 2>/dev/null || true)
    echo "${title:-$subject}"
    return
  fi

  branch=$(sed -nE "s/^Merge (remote-tracking )?branch '(origin\/)?([^']+)'( of [^ ]+)?( into [^ ]+)?$/\3/p" <<<"$subject")
  if [ -n "$branch" ]; then
    title=$(gh pr list --head "$branch" --state all --limit 1 --json title --jq '.[0].title // empty')
    echo "${title:-$branch}"
    return
  fi

  echo "$subject"
}

notes=$(git log --first-parent --format=%s "${log_args[@]}" | while IFS= read -r subject; do
  echo "- $(describe "$subject" | sed -E 's/^(\[[^]]*\] *)+//')"
done | awk '!seen[$0]++')

{
  echo 'text<<EOF'
  echo "${notes:-変更なし}"
  echo 'EOF'
} >> "$GITHUB_OUTPUT"
