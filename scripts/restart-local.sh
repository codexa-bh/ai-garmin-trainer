#!/usr/bin/env bash
set -euo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
repo="$(CDPATH= cd -- "${script_dir}/.." && pwd -P)"
log="${AI_GARMIN_RESTART_LOG:-/tmp/ai-garmin-connect-trainer-start-local-3000.log}"
ready_url="${AI_GARMIN_RESTART_READY_URL:-http://127.0.0.1:3000/}"
tmp_ps="${TMPDIR:-/tmp}/ai-garmin-connect-trainer-ps.$$"

cleanup() {
  rm -f -- "${tmp_ps}"
}

pid_cwd() {
  lsof -a -p "$1" -d cwd -Fn 2>/dev/null | awk 'substr($0,1,1)=="n"{print substr($0,2); exit}' || true
}

trap cleanup EXIT INT TERM

if [ ! -d "${repo}" ]; then
  printf 'missing repo: %s\n' "${repo}" >&2
  exit 2
fi

printf 'Stopping local server processes for repo: %s\n' "${repo}"
ps -axo pid=,command= > "${tmp_ps}"
pids_to_kill=""
while IFS= read -r line; do
  pid="$(printf '%s\n' "${line}" | awk '{print $1}')"
  [ -n "${pid}" ] || continue

  cmd="$(printf '%s\n' "${line}" | sed 's/^[[:space:]]*[0-9][0-9]*[[:space:]]*//')"
  case "${cmd}" in
    *next-server*|*"next start"*|*"next dev"*|*"npm run start:local"*|*"npm exec next"*|*"npm run dev"*) ;;
    *) continue ;;
  esac

  cwd="$(pid_cwd "${pid}")"
  if [ "${cwd}" = "${repo}" ]; then
    pids_to_kill="${pids_to_kill} ${pid}"
  fi
done < "${tmp_ps}"
rm -f -- "${tmp_ps}"

if [ -n "${pids_to_kill}" ]; then
  printf 'Killing:%s\n' "${pids_to_kill}"
  # shellcheck disable=SC2086
  kill ${pids_to_kill} 2>/dev/null || true
  sleep 2
  # shellcheck disable=SC2086
  kill -9 ${pids_to_kill} 2>/dev/null || true
else
  printf 'No local server processes found for this repo.\n'
fi

foreign_listeners=""
port_listener_pids="$(lsof -nP -tiTCP:3000 -sTCP:LISTEN 2>/dev/null || true)"
for listener_pid in ${port_listener_pids}; do
  listener_cwd="$(pid_cwd "${listener_pid}")"
  if [ "${listener_cwd}" != "${repo}" ]; then
    if [ -z "${listener_cwd}" ]; then
      listener_cwd="unknown-cwd"
    fi
    foreign_listeners="${foreign_listeners} ${listener_pid}(${listener_cwd})"
  fi
done

if [ -n "${foreign_listeners}" ]; then
  printf 'Port 3000 is already used outside this repo; refusing to kill unrelated listeners:%s\n' "${foreign_listeners}" >&2
  lsof -nP -iTCP:3000 -sTCP:LISTEN >&2 || true
  exit 1
fi

printf '\nRebuilding production bundle...\n'
(cd "${repo}" && npm run build)

printf '\nStarting local server on 127.0.0.1:3000...\n'
log_dir="$(dirname -- "${log}")"
if [ ! -d "${log_dir}" ]; then
  mkdir -p -- "${log_dir}"
fi
: > "${log}"
(cd "${repo}" && npm run start:local) > "${log}" 2>&1 &
launcher_pid=$!
printf 'launcher_pid=%s\n' "${launcher_pid}"

ready=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if curl -fsS "${ready_url}" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done

if [ "${ready}" -ne 1 ]; then
  printf 'Server did not become ready. Log tail follows:\n' >&2
  tail -n 80 "${log}" >&2
  exit 1
fi

repo_listener_found=0
port_listener_pids="$(lsof -nP -tiTCP:3000 -sTCP:LISTEN 2>/dev/null || true)"
for listener_pid in ${port_listener_pids}; do
  listener_cwd="$(pid_cwd "${listener_pid}")"
  if [ "${listener_cwd}" = "${repo}" ]; then
    repo_listener_found=1
  fi
done

if [ "${repo_listener_found}" -ne 1 ]; then
  printf 'Server responded, but no port-3000 listener belongs to this repo. Log tail follows:\n' >&2
  tail -n 80 "${log}" >&2
  printf '\nPort 3000 listeners:\n' >&2
  lsof -nP -iTCP:3000 -sTCP:LISTEN >&2 || true
  exit 1
fi

printf 'ready_url=%s\n' "${ready_url}"
printf 'log=%s\n' "${log}"
printf '\nListening process on port 3000:\n'
lsof -nP -iTCP:3000 -sTCP:LISTEN 2>/dev/null || true
