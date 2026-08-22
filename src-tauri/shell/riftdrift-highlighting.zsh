# RiftDrift command-line highlighting. This file is generated into the app cache
# and loaded only for interactive zsh sessions started by RiftDrift.

function _riftdrift_highlight_command_line() {
  emulate -L zsh
  setopt extended_glob

  local remaining="$BUFFER"
  local whitespace_re='^[[:space:]]+'
  local token_re='^("[^"]*"|'\''[^'\'']*'\''|&&|\|\||[|;<>]|[^[:space:]|;&<>]+)'
  local token style
  local -i cursor=0
  local -i command_expected=1

  # Preserve highlights owned by the user's shell configuration and replace
  # only the ranges previously created by RiftDrift.
  region_highlight=("${(@)region_highlight:#*memo=riftdrift*}")

  while (( ${#remaining} )); do
    if [[ $remaining =~ $whitespace_re ]]; then
      token=$MATCH
      (( cursor += ${#token} ))
      remaining=${remaining[$(( ${#token} + 1 )),-1]}
      continue
    fi

    if [[ $remaining =~ $token_re ]]; then
      token=$MATCH
    else
      token=${remaining[1]}
    fi

    # Plain arguments and subcommands such as `status` and `log` intentionally
    # remain bright white instead of falling back to a muted gray.
    style='fg=default'

    if [[ $token == '&&' || $token == '||' || $token == '|' || $token == ';' || $token == '>' || $token == '<' ]]; then
      style='fg=magenta'
    elif [[ $token == \"*\" || $token == \'*\' ]]; then
      style='fg=green'
    elif [[ $token == http://* || $token == https://* || $token =~ '^([0-9]{1,3}\.){3}[0-9]{1,3}(:[0-9]+)?$' ]]; then
      style='fg=blue'
    elif [[ $token == /* || $token == ./* || $token == ../* || $token == '~/'* || ( $token == */* && $token != -* ) ]]; then
      style='fg=blue'
    elif [[ $token == --* || $token == -[^-]* ]]; then
      style='fg=yellow'
    elif [[ $token =~ '^[A-Za-z_][A-Za-z0-9_]*=' ]]; then
      style='fg=magenta'
    elif (( command_expected )); then
      style='fg=cyan'
    fi

    region_highlight+=("$cursor $(( cursor + ${#token} )) $style memo=riftdrift")

    if [[ $token == '&&' || $token == '||' || $token == '|' || $token == ';' ]]; then
      command_expected=1
    elif [[ $token == '>' || $token == '<' ]]; then
      command_expected=0
    elif (( command_expected )) && [[ ! $token =~ '^[A-Za-z_][A-Za-z0-9_]*=' ]]; then
      if [[ $token == sudo || $token == env || $token == command || $token == builtin || $token == nohup || $token == time || $token == xargs ]]; then
        command_expected=1
      else
        command_expected=0
      fi
    fi

    (( cursor += ${#token} ))
    remaining=${remaining[$(( ${#token} + 1 )),-1]}
  done
}

if [[ -o interactive ]]; then
  autoload -Uz add-zle-hook-widget
  add-zle-hook-widget line-pre-redraw _riftdrift_highlight_command_line 2>/dev/null
fi
