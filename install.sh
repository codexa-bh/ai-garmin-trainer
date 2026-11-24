#!/bin/bash
# Installs or updates AI Trainer for Garmin Connect on an Apple Silicon Mac.
#
#   curl -fsSL https://raw.githubusercontent.com/codexa-bh/ai-garmin-trainer/main/install.sh | bash
#
# Downloads the disk image and its checksum from this repository's latest GitHub
# release, verifies the checksum and copies the app into /Applications, or into
# the directory given as the only argument. It needs no sudo, does not open the
# app and never touches your database or settings.
set -euo pipefail

REPOSITORY='codexa-bh/ai-garmin-trainer'
LATEST_RELEASE="https://api.github.com/repos/$REPOSITORY/releases/latest"
DOWNLOADS="https://github.com/$REPOSITORY/releases/download/"
IMAGE_SUFFIX='-macos-arm64.dmg'
# The executable kept this name when the app was renamed, so one check covers both.
PROCESS='garmin-trainer-desktop'
FORMER_APP='Garmin Trainer.app'

work=''
mounted=''
staging=''

fail() {
  printf 'install: %s\n' "$1" >&2
  exit 1
}

cleanup() {
  if [ -n "$staging" ]; then
    rm -rf "${staging:?}"
  fi
  if [ -n "$mounted" ] && ! hdiutil detach "$mounted" -quiet; then
    printf 'install: could not unmount %s\n' "$mounted" >&2
    return
  fi
  if [ -n "$work" ]; then
    rm -rf "${work:?}"
  fi
}

refuse_while_running() {
  if pgrep -x "$PROCESS" >/dev/null; then
    fail 'the app is running; quit it, then run the installer again'
  fi
}

# Everything runs from main, called on the last line, so that an interrupted
# download of this script cannot execute half of it.
main() {
  [ "$#" -le 1 ] || fail 'usage: install.sh [destination directory]'
  local destination="${1:-/Applications}"

  [ "$(uname -s)" = 'Darwin' ] || fail 'this installer is for macOS'
  [ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" = '1' ] ||
    fail 'an Apple Silicon Mac is required'
  [ -d "$destination" ] && [ -w "$destination" ] ||
    fail "cannot write to $destination; pass another directory, for example ~/Applications"
  refuse_while_running

  local release url
  release="$(curl -fsSL -H 'Accept: application/vnd.github+json' "$LATEST_RELEASE")" ||
    fail 'could not read the latest release from GitHub'
  url="$(printf '%s\n' "$release" |
    sed -n 's/^.*"browser_download_url": *"\([^"]*'"$IMAGE_SUFFIX"'\)".*$/\1/p')"
  case "$url" in
    '' | *[[:space:]]*) fail 'the latest release has no single macOS download' ;;
    "$DOWNLOADS"*"$IMAGE_SUFFIX") ;;
    *) fail 'the latest release points outside this repository; nothing was downloaded' ;;
  esac
  local image="${url##*/}"
  case "$image" in
    *[!A-Za-z0-9._-]*) fail 'unexpected download name; nothing was downloaded' ;;
  esac

  work="$(mktemp -d "${TMPDIR:-/tmp}/ai-trainer-install.XXXXXX")"
  trap cleanup EXIT

  printf 'Downloading %s\n' "$image"
  curl -fL --progress-bar -o "$work/$image" "$url" || fail 'the download failed'
  curl -fsSL -o "$work/$image.sha256" "$url.sha256" ||
    fail 'the checksum download failed; nothing was installed'
  local expected actual
  expected="$(awk 'NR == 1 { print $1 }' "$work/$image.sha256")"
  actual="$(shasum -a 256 "$work/$image" | awk '{ print $1 }')"
  case "$expected" in
    '' | *[!0-9a-f]*) fail 'the published checksum is malformed; nothing was installed' ;;
  esac
  [ "${#expected}" -eq 64 ] && [ "$expected" = "$actual" ] ||
    fail 'the download does not match its published checksum; nothing was installed'

  local mount="$work/image"
  mkdir "$mount"
  hdiutil attach "$work/$image" -readonly -nobrowse -noautoopen -mountpoint "$mount" -quiet ||
    fail 'could not open the disk image; nothing was installed'
  mounted="$mount"
  set -- "$mount"/*.app
  [ "$#" -eq 1 ] && [ -d "$1" ] && [ ! -L "$1" ] ||
    fail 'unexpected disk image contents; nothing was installed'
  local app="${1##*/}"

  # Copy beside the target first, so a failed copy leaves the installed app intact.
  staging="$(mktemp -d "$destination/.$app.installing.XXXXXX")"
  ditto "$1" "$staging" || fail 'the copy failed; the installed app was not changed'
  refuse_while_running
  rm -rf "${destination:?}/${app:?}" ||
    fail 'could not remove the installed app; remove it yourself, then run the installer again'
  mv "$staging" "$destination/$app"
  staging=''

  printf 'Installed %s in %s\n' "$app" "$destination"
  if [ "$app" != "$FORMER_APP" ] && [ -e "$destination/$FORMER_APP" ]; then
    printf 'The earlier %s is still there and uses the same data. Retain a compatible prior copy; do not run both.\n' \
      "$FORMER_APP"
  fi
  printf 'Open it from %s, or run: open "%s"\n' "$destination" "$destination/$app"
}

main "$@"
