#!/usr/bin/env bash
#
# setup.sh — הקמת שרת וואטסאפ ייעודי ל-CRM, על שרת Ubuntu 24.04 חדש וריק.
#
# רץ פעם אחת, לבד, מתוך cloud-config בזמן יצירת השרת (Hetzner → "Cloud config").
# אין SSH, אין סיסמה, אין פקודות ידניות. בסוף:
#   · ה-Hub רץ כשירות (127.0.0.1:5400), מאחורי Caddy עם HTTPS אוטומטי,
#     בכתובת חינמית wa-<ip>.sslip.io.
#   · webhook מה-Hub ל-CRM (wa-webhook) נרשם, עם סוד חתימה חדש.
#   · השרת מוסר ל-CRM (wa-provision) את הכתובת, המפתח והסוד — עם טוקן חד-פעמי.
#   · סריקת ה-QR: מתוך ה-CRM, מסך הגדרות.
# לוג מלא: /var/log/wa-setup.log. פרטי גישה (למקרה חירום): /root/wa-credentials (600).
#
# ★ שרת ייעודי. לא קשור לשרת של לנגר ולא נוגע בו.
set -euo pipefail
exec > >(tee -a /var/log/wa-setup.log) 2>&1

HUB_TARBALL_URL="__HUB_TARBALL_URL__"
PROVISION_URL="__PROVISION_URL__"
PROVISION_TOKEN="__PROVISION_TOKEN__"
WEBHOOK_URL="__WEBHOOK_URL__"
NODE_VERSION="v22.14.0"
HUB_HOME="/opt/whatsapp-hub"
HUB_USER="wahub"
PORT=5400

say() { echo -e "\n▸ $(date '+%H:%M:%S') $*"; }
die() { echo "✗ $*"; exit 1; }
[[ $EUID -eq 0 ]] || die "יש להריץ כ-root"
[[ ! -e "$HUB_HOME/.env" ]] || die "כבר מותקן ($HUB_HOME/.env קיים) — לא דורסים"

say "כתובת"
IP=$(curl -fsS --max-time 5 http://169.254.169.254/hetzner/v1/metadata/public-ipv4 || curl -fsS --max-time 5 https://api.ipify.org)
[[ "$IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "לא נמצאה כתובת IP ציבורית"
DOMAIN="wa-${IP//./-}.sslip.io"
echo "  $IP → https://$DOMAIN"

say "חבילות מערכת וחומת אש"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q curl ca-certificates xz-utils ufw unattended-upgrades >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
# זיכרון: npm ci ו-baileys על שרת קטן — swap של 2GB מונע קריסה.
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

say "קוד ה-Hub"
useradd --system --home-dir "$HUB_HOME" --shell /usr/sbin/nologin "$HUB_USER"
mkdir -p "$HUB_HOME"
curl -fsSL "$HUB_TARBALL_URL" | tar -xz -C "$HUB_HOME"
for p in auth data media .env; do [[ ! -e "$HUB_HOME/$p" ]] || die "$p הגיע בחבילה — לא אמור לקרות"; done

say "Node מקומי ($NODE_VERSION)"
mkdir -p "$HUB_HOME/.node"
curl -fsSL "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.xz" | tar -xJ -C "$HUB_HOME/.node" --strip-components=1
chown -R "$HUB_USER:$HUB_USER" "$HUB_HOME"
NODE_BIN="$HUB_HOME/.node/bin"

say "תלויות"
cd "$HUB_HOME"
sudo -u "$HUB_USER" env PATH="$NODE_BIN:$PATH" HOME="$HUB_HOME" npm ci --no-audit --no-fund >/dev/null

say ".env"
API_KEY=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
DASH_PW=$(head -c 18 /dev/urandom | base64 | tr -d '/+=' | cut -c1-20)
WEBHOOK_SECRET=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
cat > "$HUB_HOME/.env" <<ENV
PORT=${PORT}
HOST=127.0.0.1
API_KEY=${API_KEY}
DASHBOARD_PASSWORD=${DASH_PW}
DEVICE_NAME=CRM - החוג
ENV
chown "$HUB_USER:$HUB_USER" "$HUB_HOME/.env"; chmod 600 "$HUB_HOME/.env"
umask 077
cat > /root/wa-credentials <<CRED
# פרטי גישה לשרת הוואטסאפ — לחירום בלבד. ה-CRM כבר קיבל אותם.
DOMAIN=https://${DOMAIN}
API_KEY=${API_KEY}
DASHBOARD_PASSWORD=${DASH_PW}
WEBHOOK_SECRET=${WEBHOOK_SECRET}
CRED
umask 022

say "שירות"
cat > /etc/systemd/system/whatsapp-hub.service <<UNIT
[Unit]
Description=WhatsApp Hub (CRM)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${HUB_USER}
WorkingDirectory=${HUB_HOME}
Environment=PATH=${NODE_BIN}:/usr/local/bin:/usr/bin:/bin
Environment=HOME=${HUB_HOME}
ExecStart=${NODE_BIN}/npm start
Restart=always
RestartSec=10
MemoryMax=900M
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true
ReadWritePaths=${HUB_HOME}

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now whatsapp-hub >/dev/null 2>&1
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "x-api-key: ${API_KEY}" "http://127.0.0.1:${PORT}/api/status" || true)
  [[ "$code" == "200" ]] && break; sleep 3
done
[[ "$code" == "200" ]] || { journalctl -u whatsapp-hub -n 40 --no-pager; die "השירות לא עלה"; }
echo "  ✔ ה-Hub רץ"

say "HTTPS (Caddy)"
mkdir -p /opt/caddy
curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=amd64" -o /opt/caddy/caddy && chmod +x /opt/caddy/caddy
cat > /opt/caddy/Caddyfile <<CDY
${DOMAIN} {
	request_body {
		max_size 25MB
	}
	reverse_proxy 127.0.0.1:${PORT} {
		header_up Host 127.0.0.1
	}
}
CDY
cat > /etc/systemd/system/caddy.service <<UNIT
[Unit]
Description=Caddy (HTTPS for WhatsApp Hub)
After=network-online.target

[Service]
ExecStart=/opt/caddy/caddy run --config /opt/caddy/Caddyfile --adapter caddyfile
ExecReload=/opt/caddy/caddy reload --config /opt/caddy/Caddyfile --adapter caddyfile
Environment=XDG_DATA_HOME=/opt/caddy/data
Environment=XDG_CONFIG_HOME=/opt/caddy/config
Restart=always
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now caddy >/dev/null 2>&1
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "x-api-key: ${API_KEY}" "https://${DOMAIN}/api/status" || true)
  [[ "$code" == "200" ]] && break; sleep 5
done
[[ "$code" == "200" ]] || die "HTTPS לא עלה ב-https://${DOMAIN} (תעודה?)"
echo "  ✔ https://${DOMAIN}"

say "webhook ל-CRM"
curl -fsS -X POST "http://127.0.0.1:${PORT}/api/webhooks" -H "x-api-key: ${API_KEY}" -H "Content-Type: application/json" \
  -d "{\"name\":\"CRM\",\"url\":\"${WEBHOOK_URL}\",\"events\":[\"message.received\",\"message.sent\",\"message.failed\",\"connection.changed\"],\"secret\":\"${WEBHOOK_SECRET}\"}" >/dev/null
echo "  ✔ נרשם"

say "מסירת הפרטים ל-CRM"
for i in $(seq 1 10); do
  resp=$(curl -s -X POST "$PROVISION_URL" -H "x-provision-token: ${PROVISION_TOKEN}" -H "Content-Type: application/json" \
    -d "{\"server_url\":\"https://${DOMAIN}\",\"api_key\":\"${API_KEY}\",\"webhook_secret\":\"${WEBHOOK_SECRET}\"}" || true)
  echo "  $resp"
  [[ "$resp" == *'"ok":true'* ]] && break
  sleep 15
done
[[ "$resp" == *'"ok":true'* ]] || die "ה-CRM לא קיבל את הפרטים"

say "✔ השרת מוכן. את ה-QR סורקים מה-CRM: הגדרות ← חיבור וואטסאפ."
