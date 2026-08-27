#!/bin/bash
set -eu

missing=""
for name in "$@"; do
  if [ -z "${!name:-}" ]; then
    missing="$missing $name"
  fi
done

if [ -n "$missing" ]; then
  echo "::error::入力が不足しています:$missing"
  exit 1
fi
