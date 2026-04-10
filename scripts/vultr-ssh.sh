#!/bin/bash
# SSH into the Vultr VPS
# Usage: ./scripts/vultr-ssh.sh [command]
# Examples:
#   ./scripts/vultr-ssh.sh                     # interactive shell
#   ./scripts/vultr-ssh.sh "systemctl status"  # run command

SSH_KEY="$HOME/.ssh/vps-key"
HOST="root@YOUR_VPS_IP"

if [ -n "$1" ]; then
  ssh -i "$SSH_KEY" "$HOST" "$@"
else
  ssh -i "$SSH_KEY" "$HOST"
fi
