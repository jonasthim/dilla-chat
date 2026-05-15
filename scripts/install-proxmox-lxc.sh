#!/usr/bin/env bash
#
# Proxmox LXC installer for the Dilla server.
#
# Run on the PVE host as root:
#
#   bash -c "$(curl -fsSL https://raw.githubusercontent.com/dilla-chat/dilla-chat/main/scripts/install-proxmox-lxc.sh)"
#
# Or with overrides:
#
#   CTID=210 CT_HOSTNAME=chat MEMORY=2048 \
#     bash -c "$(curl -fsSL https://raw.githubusercontent.com/dilla-chat/dilla-chat/main/scripts/install-proxmox-lxc.sh)"
#
# Creates an unprivileged Debian 12 container, downloads the latest
# release binary from GitHub, and installs it as a systemd service.
# Exposes the Dilla HTTP/WS port on the LXC's IP address — terminate
# TLS with your own reverse proxy (Caddy, nginx, Cloudflare Tunnel, …).

set -Eeuo pipefail

# ---- Defaults ---------------------------------------------------------------

: "${CTID:=}"                      # auto-pick if empty
# NB: HOSTNAME is a bash builtin (set to the host's hostname). Use CT_HOSTNAME.
: "${CT_HOSTNAME:=dilla}"
: "${STORAGE:=}"                   # auto-detect first active rootdir storage if empty
: "${TEMPLATE_STORE:=local}"       # template cache
: "${BRIDGE:=vmbr0}"
: "${CORES:=2}"
: "${MEMORY:=1024}"                # MiB
: "${SWAP:=512}"                   # MiB
: "${DISK_GB:=8}"
: "${UNPRIVILEGED:=1}"
: "${IPV4:=dhcp}"                  # or "10.0.0.50/24,gw=10.0.0.1"
: "${DILLA_PORT:=8080}"
: "${RELEASE_TAG:=nightly}"
: "${RELEASE_REPO:=dilla-chat/dilla-chat}"

readonly TIMER_LIMIT=120

# Color palette matches community-scripts/ProxmoxVE for a familiar look.
YW=$'\033[33m'; GN=$'\033[1;92m'; RD=$'\033[01;31m'; BL=$'\033[36m'
DGN=$'\033[32m'; CL=$'\033[m'; BFR=$'\r\033[K'
CM=$' ✓\033[0m'; CROSS=$' ✗\033[0m'; HOLD=' '

SPINNER_PID=""

spinner_start() {
  local i=0 frames='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  while :; do
    printf "\r ${YW}%s${CL} %s" "${frames:i++%${#frames}:1}" "$1"
    sleep 0.1
  done
}

start_spinner() {
  [[ -t 1 ]] || { echo " ${HOLD}${YW}$1...${CL}"; return; }
  spinner_start "$1" &
  SPINNER_PID=$!
  disown 2>/dev/null || true
}

stop_spinner() {
  [[ -n "$SPINNER_PID" ]] || return 0
  kill "$SPINNER_PID" 2>/dev/null || true
  wait "$SPINNER_PID" 2>/dev/null || true
  SPINNER_PID=""
  printf "%s" "$BFR"
}

msg_info()  { stop_spinner; start_spinner "$1"; }
msg_ok()    { stop_spinner; echo -e "${BFR}${CM}${GN} $1${CL}"; }
msg_error() { stop_spinner; echo -e "${BFR}${CROSS}${RD} $1${CL}" >&2; }
msg_warn()  { stop_spinner; echo -e " ${YW}!${CL} $1" >&2; }
die()       { msg_error "$1"; exit 1; }

trap 'stop_spinner; die "Aborted on line $LINENO"' ERR
trap 'stop_spinner' EXIT

show_header() {
  cat <<'EOF'

    ____  _ ____
   / __ \(_) / /___ _
  / / / / / / / __ `/
 / /_/ / / / / /_/ /
/_____/_/_/_/\__,_/

EOF
  echo -e "${DGN}      Dilla LXC Installer${CL}"
  echo -e "${BL}      federated · end-to-end encrypted chat${CL}"
  echo
}

# ---- Pre-flight -------------------------------------------------------------

show_header

[[ $EUID -eq 0 ]]            || die "Run as root on the Proxmox host."
command -v pct >/dev/null    || die "pct not found — this must run on a Proxmox VE host."
command -v pveam >/dev/null  || die "pveam not found — Proxmox VE tools missing."

# ---- Pick a CTID ------------------------------------------------------------

if [[ -z "$CTID" ]]; then
  CTID=$(pvesh get /cluster/nextid)
fi

if pct status "$CTID" &>/dev/null; then
  die "CTID $CTID is already in use."
fi

# ---- Pick a rootfs storage --------------------------------------------------

if [[ -z "$STORAGE" ]]; then
  # Auto-detect: first active storage that supports rootdir/container content.
  # Prefer well-known defaults if present.
  available=$(pvesm status -content rootdir 2>/dev/null | awk 'NR>1 && $3=="active" {print $1}')
  [[ -n "$available" ]] || die "No active storage with content type 'rootdir' found. Set STORAGE=… explicitly."
  for preferred in local-lvm local-zfs local; do
    if grep -qx "$preferred" <<<"$available"; then
      STORAGE="$preferred"
      break
    fi
  done
  [[ -n "$STORAGE" ]] || STORAGE=$(head -n1 <<<"$available")
  msg_ok "Using auto-detected rootfs storage: ${STORAGE}"
elif ! pvesm status -storage "$STORAGE" &>/dev/null; then
  die "Storage '${STORAGE}' does not exist. Available rootdir storages: $(pvesm status -content rootdir 2>/dev/null | awk 'NR>1 {print $1}' | xargs)"
fi

# ---- Locate or download a Debian 12 template --------------------------------

msg_info "Refreshing template index"
pveam update >/dev/null
msg_ok "Template index refreshed"

template_name=$(
  pveam available --section system \
    | awk '/^[[:space:]]*system[[:space:]]+debian-12-standard/ {print $2}' \
    | sort -V | tail -n1
)
[[ -n "$template_name" ]] || die "No debian-12-standard template available from pveam."

template_path="${TEMPLATE_STORE}:vztmpl/${template_name}"
local_path="/var/lib/vz/template/cache/${template_name}"

if [[ ! -f "$local_path" ]]; then
  msg_info "Downloading ${template_name} to ${TEMPLATE_STORE}"
  pveam download "$TEMPLATE_STORE" "$template_name" >/dev/null 2>&1
  msg_ok "Downloaded ${template_name}"
else
  msg_ok "Template ${template_name} cached"
fi

# ---- Create the container ---------------------------------------------------

msg_info "Creating LXC ${CTID} (${CT_HOSTNAME})"

db_passphrase=$(head -c 32 /dev/urandom | base64 | tr -d '+/=' | head -c 32)

pct create "$CTID" "$template_path" \
  --hostname "$CT_HOSTNAME" \
  --cores "$CORES" \
  --memory "$MEMORY" \
  --swap "$SWAP" \
  --rootfs "${STORAGE}:${DISK_GB}" \
  --net0 "name=eth0,bridge=${BRIDGE},ip=${IPV4}" \
  --unprivileged "$UNPRIVILEGED" \
  --features "nesting=1" \
  --onboot 1 \
  --start 0 \
  >/dev/null
msg_ok "Created CT ${CTID}"

msg_info "Starting CT ${CTID} and waiting for network"
pct start "$CTID"

# Wait for network/dns inside the container.
for ((i = 0; i < TIMER_LIMIT; i++)); do
  if pct exec "$CTID" -- getent hosts github.com &>/dev/null; then
    break
  fi
  sleep 1
done
pct exec "$CTID" -- getent hosts github.com &>/dev/null \
  || die "Container has no network connectivity to github.com after ${TIMER_LIMIT}s."
msg_ok "Container is online"

# ---- Bootstrap inside the container ----------------------------------------

msg_info "Installing dependencies inside CT ${CTID}"
pct exec "$CTID" -- bash -c '
  set -Eeuo pipefail
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends ca-certificates curl >/dev/null
'
msg_ok "Installed dependencies"

arch=$(pct exec "$CTID" -- dpkg --print-architecture)
case "$arch" in
  amd64) bin_asset=dilla-server-linux-amd64 ;;
  arm64) bin_asset=dilla-server-linux-arm64 ;;
  *)     die "Unsupported container architecture: $arch" ;;
esac

asset_url="https://github.com/${RELEASE_REPO}/releases/download/${RELEASE_TAG}/${bin_asset}"

msg_info "Downloading ${bin_asset} from ${RELEASE_TAG} release"
pct exec "$CTID" -- bash -c "
  set -Eeuo pipefail
  curl --fail --location --silent --show-error \
    -o /usr/local/bin/dilla-server '${asset_url}'
  chmod 0755 /usr/local/bin/dilla-server
"
msg_ok "Installed dilla-server binary"

msg_info "Provisioning user, data dir, and systemd unit"
pct exec "$CTID" -- bash -c "
  set -Eeuo pipefail
  if ! id dilla &>/dev/null; then
    useradd --system --home-dir /var/lib/dilla --shell /usr/sbin/nologin dilla
  fi
  install -d -o dilla -g dilla -m 0750 /var/lib/dilla /etc/dilla

  umask 077
  cat >/etc/dilla/dilla.env <<EOF
DILLA_PORT=${DILLA_PORT}
DILLA_DATA_DIR=/var/lib/dilla
DILLA_DB_PASSPHRASE=${db_passphrase}
EOF
  chown root:dilla /etc/dilla/dilla.env
  chmod 0640 /etc/dilla/dilla.env

  cat >/etc/systemd/system/dilla.service <<'EOF'
[Unit]
Description=Dilla federated chat server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=dilla
Group=dilla
EnvironmentFile=/etc/dilla/dilla.env
ExecStart=/usr/local/bin/dilla-server
Restart=on-failure
RestartSec=5
ReadWritePaths=/var/lib/dilla
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable --now dilla.service
"
msg_ok "Provisioned systemd unit"

# ---- Wait for the service to come up ---------------------------------------

msg_info "Waiting for dilla-server to come up"
for ((i = 0; i < TIMER_LIMIT; i++)); do
  if pct exec "$CTID" -- systemctl is-active --quiet dilla.service; then
    break
  fi
  sleep 1
done
pct exec "$CTID" -- systemctl is-active --quiet dilla.service \
  || die "dilla.service failed to start. Check 'pct exec ${CTID} -- journalctl -u dilla -n 100'."
msg_ok "dilla-server is active"

container_ip=$(pct exec "$CTID" -- bash -c "hostname -I | awk '{print \$1}'" || true)

echo
echo -e " ${GN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${CL}"
echo -e " ${GN}  Dilla is up in CT ${CTID}${CL}"
echo -e " ${GN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${CL}"
echo
echo -e "   ${YW}Container ID${CL} : ${CTID}"
echo -e "   ${YW}Hostname${CL}     : ${CT_HOSTNAME}"
[[ -n "${container_ip:-}" ]] && echo -e "   ${YW}Address${CL}      : ${BL}http://${container_ip}:${DILLA_PORT}${CL}"
echo -e "   ${YW}Logs${CL}         : pct exec ${CTID} -- journalctl -u dilla -f"
echo -e "   ${YW}Shell${CL}        : pct enter ${CTID}"
echo -e "   ${YW}Env file${CL}     : /etc/dilla/dilla.env (inside the CT)"
echo
echo -e " ${DGN}Next:${CL} terminate TLS with your reverse proxy of choice and point"
echo -e "       it at the address above. Edit /etc/dilla/dilla.env to set"
echo -e "       DILLA_PEERS, DILLA_TLS_CERT/KEY, or other DILLA_* options."
echo
