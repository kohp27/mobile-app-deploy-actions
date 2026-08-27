#!/bin/bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
bash "$script_dir/require_env.sh" \
  KEYSTORE_BASE64 \
  STORE_PASSWORD \
  KEY_PASSWORD \
  KEY_ALIAS \
  KEYSTORE_PATH \
  PROPERTIES_PATH

mkdir -p "$(dirname "$KEYSTORE_PATH")"
printf '%s' "$KEYSTORE_BASE64" | base64 -d > "$KEYSTORE_PATH"
{
  echo "storeFile=$(cd "$(dirname "$KEYSTORE_PATH")" && pwd)/$(basename "$KEYSTORE_PATH")"
  echo "storePassword=$STORE_PASSWORD"
  echo "keyAlias=$KEY_ALIAS"
  echo "keyPassword=$KEY_PASSWORD"
} > "$PROPERTIES_PATH"
