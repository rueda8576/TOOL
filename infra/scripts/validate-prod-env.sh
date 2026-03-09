#!/usr/bin/env sh
set -eu

ENV_FILE="${1:-.env}"

if [ ! -f "${ENV_FILE}" ]; then
  echo "Missing env file: ${ENV_FILE}" >&2
  exit 1
fi

value_from_env() {
  key="$1"
  awk -F= -v key="${key}" '
    $0 ~ "^[[:space:]]*"key"=" {
      v = substr($0, index($0, "=") + 1)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", v)
      print v
    }
  ' "${ENV_FILE}" | tail -n 1
}

JWT_SECRET_VALUE="$(value_from_env JWT_SECRET)"
if [ -z "${JWT_SECRET_VALUE}" ]; then
  echo "JWT_SECRET is missing in ${ENV_FILE}" >&2
  exit 1
fi

JWT_SECRET_LEN="$(printf "%s" "${JWT_SECRET_VALUE}" | wc -c | tr -d '[:space:]')"
if [ "${JWT_SECRET_LEN}" -lt 16 ]; then
  echo "JWT_SECRET must be at least 16 characters (current: ${JWT_SECRET_LEN}) in ${ENV_FILE}" >&2
  exit 1
fi

echo "Env validation OK (${ENV_FILE})."
