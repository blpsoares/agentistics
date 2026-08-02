#!/usr/bin/env bash
#
# record-cast.sh — record one asciinema cast of an interactive agentop screen.
#
# The control center and the TUI are full-screen Ink applications: they need a
# real pty and they must be driven by keystrokes, which `asciinema rec -c` alone
# cannot do. So the program runs inside a detached tmux session, keys are sent to
# it from outside, and asciinema records a READ-ONLY attach to that session — the
# recording therefore captures exactly what a user would see, with no recorder
# chrome and no stray input of our own.
#
# Usage:
#   record-cast.sh <name> <cols> <rows> <command> [-- <key> <delay-ms> ...]
#
#   record-cast.sh control 120 34 "agentop start" -- Right 1200 Right 1200 q 400
#
# Output: $OUT_DIR/<name>.cast   (OUT_DIR defaults to ./casts)
#
# Env:
#   OUT_DIR      where the .cast lands
#   HOME_DIR     HOME for the recorded program (use a demo home — never your own)
#   EXTRA_ENV    extra "K=V K=V" passed to the recorded program
#   SETTLE_MS    wait after start before the first key (default 2500)
#   TAIL_MS      wait after the last key before stopping (default 1500)

set -euo pipefail

NAME="${1:?name required}"
COLS="${2:?cols required}"
ROWS="${3:?rows required}"
CMD="${4:?command required}"
shift 4
[ "${1:-}" = "--" ] && shift

OUT_DIR="${OUT_DIR:-./casts}"
SETTLE_MS="${SETTLE_MS:-2500}"
TAIL_MS="${TAIL_MS:-1500}"
SESSION="rec_${NAME}_$$"

mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR/$NAME.cast"

sleep_ms() { sleep "$(awk "BEGIN{print $1/1000}")"; }

cleanup() { tmux kill-session -t "$SESSION" 2>/dev/null || true; }
trap cleanup EXIT

# A fixed size is what keeps every cast in a set visually consistent; the Ink
# screens lay themselves out from it, so it must be set before the program runs.
#
# The pane runs a BARE shell (--noprofile --norc) with a neutral prompt. The
# operator's own prompt is the leak nobody thinks about: a themed prompt puts the
# host, the cwd, the git branch and — with the common work setups — an e-mail
# address on screen, and it reappears the moment the recorded program exits. A
# published GIF cannot be taken back, so the prompt is replaced, not trusted.
tmux new-session -d -s "$SESSION" -x "$COLS" -y "$ROWS" \
  "env -u PROMPT_COMMAND -u STARSHIP_SHELL PS1='$ ' bash --noprofile --norc"
tmux set-option -t "$SESSION" status off
tmux send-keys -t "$SESSION" "clear" Enter

# asciinema records the read-only attach. `-q` keeps its own banner out of the
# cast; the attach ends when we kill the session, which ends the recording.
env HOME="${HOME_DIR:-$HOME}" asciinema rec -q \
  --cols "$COLS" --rows "$ROWS" \
  -c "tmux attach -t $SESSION -r" \
  "$OUT_DIR/$NAME.cast" &
REC_PID=$!

sleep_ms 600  # let the recorder attach before anything happens on screen

tmux send-keys -t "$SESSION" "clear && ${EXTRA_ENV:-} $CMD" Enter
sleep_ms "$SETTLE_MS"

while [ $# -gt 0 ]; do
  key="$1"; delay="${2:?each key needs a delay}"; shift 2
  # A literal string is sent as text; a named key (Enter, Right, C-c…) as a key.
  case "$key" in
    Enter|Escape|Tab|BTab|Space|Up|Down|Left|Right|Home|End|PageUp|PageDown|C-*|M-*)
      tmux send-keys -t "$SESSION" "$key" ;;
    *)
      tmux send-keys -t "$SESSION" -l "$key" ;;
  esac
  sleep_ms "$delay"
done

sleep_ms "$TAIL_MS"
cleanup
wait "$REC_PID" 2>/dev/null || true

echo "recorded $OUT_DIR/$NAME.cast"
