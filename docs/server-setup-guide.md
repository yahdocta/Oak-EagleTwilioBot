# Oak & Eagle Twilio Bot: Server + Public URL Setup Guide

This guide starts from an unconfigured server and gets you to a working public webhook URL for Twilio plus a browser-accessible campaign console.

## 1. What this project needs

Your app must be reachable over HTTPS on:

- `https://<your-domain>/twilio/voice/outbound`
- `https://<your-domain>/twilio/voice/status`
- `https://<your-domain>/`

Twilio cannot call `localhost`, so you need a public URL. The current host setup is:

- Ubuntu home server
- Node.js app managed by systemd
- Cloudflare Tunnel

Docker + Portainer is still a reasonable future packaging path, but the current
repo ships the systemd service helper.

## 2. Prerequisites checklist

Before you begin, confirm you have:

- A domain in Cloudflare DNS (or you can move DNS there)
- A Twilio account + phone number with Voice enabled
- A Google Sheet + service account JSON key
- Ubuntu server with SSH access

## 3. Prepare app config locally

1. Copy `.env.example` to `.env` if needed.
2. Set these values in `.env`:

```env
SHEETS_SPREADSHEET_ID=...
SHEETS_SHEET_NAME=...
GOOGLE_SERVICE_ACCOUNT_JSON=./service-account.json

TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=+1...

PORT=3000
TWILIO_AMD_MODE=DetectMessageEnd
TWILIO_VOICE=
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
ELEVENLABS_MODEL_ID=eleven_flash_v2_5
ELEVENLABS_OUTPUT_FORMAT=mp3_44100_128
ELEVENLABS_CACHE_DIR=.cache/elevenlabs
TWILIO_VOICEMAIL_TEXT=Hi this is Kevin calling from Oak and Eagle...
BATCH_MAX_CONCURRENCY=20
INTENT_MAX_RETRIES=2

# npm start launches Cloudflare Tunnel by default.
CLOUDFLARED_AUTO_START=true
CLOUDFLARED_COMMAND=cloudflared
CLOUDFLARED_CONFIG=~/.cloudflared/config.yml
CLOUDFLARED_TUNNEL=

# Fill these after tunnel/domain is live:
PUBLIC_BASE_URL=https://calls.yourdomain.com/
TWILIO_STATUS_CALLBACK_URL=https://calls.yourdomain.com/twilio/voice/status
```

3. Keep `service-account.json` out of git (already handled in `.gitignore`).

## 4. Bring up app on Ubuntu server

Choose one of the two paths below:

### Path A: Node runtime with systemd

```bash
sudo apt update
sudo apt install -y curl git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Deploy app:

```bash
git clone <your-repo-url>
cd Oak-EagleTwilioBot
npm install
```

Add `.env` and `service-account.json`, then:

```bash
npm run check
npm start
```

App should answer:

```text
http://localhost:3000/healthz
http://localhost:3000/
```

The `/` route is the campaign console for uploading CSVs, starting one-shot or looping campaigns immediately, scheduling one-shot or looping campaigns for a chosen date/time and time zone, pausing/resuming running campaigns, ending running campaigns, cancelling scheduled campaigns, watching activity, viewing/removing/sorting recurring leads, inspecting transcripts, saving recurring CSV exports, and checking Cloudflare Tunnel status.

By default, `npm start` also launches:

```bash
cloudflared tunnel --config ~/.cloudflared/config.yml run
```

To run the tunnel yourself instead, set:

```env
CLOUDFLARED_AUTO_START=false
```

#### Run 24/7 with systemd

For a server that should keep the bot running after you close VS Code or log out
of SSH, install the app as a `systemd` service from the project directory:

```bash
Ctrl+C # stop any manual npm start process first
npm run service:print
sudo npm run service:install
```

The generated service:

- runs `npm start` from this checkout
- loads this checkout's `.env` file when it exists
- runs as the current server user by default
- waits for the network to be online
- restarts automatically if the Node process exits
- sends `SIGTERM` so the app can shut down Express and Cloudflare Tunnel cleanly

Useful service commands:

```bash
sudo systemctl status oak-eagle-twilio-bot --no-pager
sudo systemctl restart oak-eagle-twilio-bot
sudo systemctl stop oak-eagle-twilio-bot
journalctl -u oak-eagle-twilio-bot -f
```

If Node was installed somewhere other than `/usr/bin/npm`, set the path before
installing:

```bash
OAK_EAGLE_SERVICE_NPM="$(command -v npm)" sudo -E npm run service:install
```

The current app keeps active campaign state in memory, so scheduled/running
campaigns are still reset by service restarts, server reboots, or deploys. The
service makes the process durable; it does not yet persist live campaign state.

### Path B: Docker runtime with Portainer

If your server has Docker and Portainer already running, use this path for easier
management and updates.

Deploy app:

```bash
git clone <your-repo-url>
cd Oak-EagleTwilioBot
```

Add `.env` and `service-account.json`, then build and start:

```bash
docker-compose up -d
```

Manage the container:

```bash
docker-compose ps                      # Check status
docker-compose logs -f oak-eagle-bot   # View live logs
docker-compose restart                 # Restart
docker-compose stop                    # Stop
docker-compose down                    # Stop and remove
```

Or use Portainer:
1. Log into Portainer at `https://localhost:9000`
2. Go to **Stacks** → see `oak-eagle-twilio-bot` listed
3. Click to view logs, restart, or stop

**Docker automatically:**
- Restarts the container on failure
- Persists campaign data and ElevenLabs cache
- Mounts `.env` and `service-account.json` as read-only
- Mounts Cloudflare credentials from `~/.cloudflared/`
- Binds port 3000 on the host

Both systemd and Docker run Node 20 and include `cloudflared`, so tunnel startup and Twilio webhook delivery work identically.

## 5. Create Cloudflare Tunnel (public HTTPS URL)

On the Ubuntu server:

1. Install `cloudflared` (Cloudflare docs package for Ubuntu).
2. Authenticate:

```bash
cloudflared tunnel login
```

3. Create tunnel:

```bash
cloudflared tunnel create oak-eagle-bot
```

4. Route DNS:

```bash
cloudflared tunnel route dns oak-eagle-bot calls.yourdomain.com
```

5. Create `~/.cloudflared/config.yml`:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: /home/<user>/.cloudflared/<TUNNEL_ID>.json

ingress:
  - hostname: calls.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
```

6. Start the app, which also starts the tunnel by default:

```bash
npm start
```

Or run the tunnel manually if `CLOUDFLARED_AUTO_START=false`:

```bash
cloudflared tunnel run oak-eagle-bot
```

7. Validate:

- `https://calls.yourdomain.com/healthz` should return `{ "ok": true }`
- `https://calls.yourdomain.com/` should load the campaign console

If you expose the root console on the public internet, put the tunnel hostname behind an access control layer such as Cloudflare Access, a VPN, or a reverse proxy with authentication. The UI can start real outbound calls.

## 6. Finalize Twilio settings

In Twilio Console for your phone number (Voice webhook):

- Voice URL: `https://calls.yourdomain.com/twilio/voice/outbound`
- HTTP Method: `POST`
- Status callback URL: `https://calls.yourdomain.com/twilio/voice/status`
- Status events: initiated, ringing, answered, completed

## 7. Run first end-to-end test

1. Start app.
2. Confirm startup logs include `cloudflared.starting`.
3. Open `https://calls.yourdomain.com/`.
4. Upload a tiny CSV with 1-2 leads. Add an optional `city` or `lead_city` column if you want the opening question to include the city. Add an optional `address` or `lead_address` column if you want the address logged. For a DealMachine export, check `Deal Machine CSV` before uploading so the app converts `contact_id`, `associated_property_address_full`, and `phone_1`/`phone_2`/`phone_3` into the campaign format and derives `lead_city` where possible. For a previously saved recurring call list, check `Recurring export CSV` before uploading so closed rows are removed and the remaining rows become a normal campaign CSV.
5. Start the campaign from the page, or check `Schedule for later` and choose a start date/time plus time zone.
6. Watch the Activity section.
7. Confirm the Cloudflare Tunnel metric says `Running`.
8. Confirm confirmed interested leads are appended to your Google Sheet after calls finish. Declines, no-answer, voicemail, and unresolved calls update the campaign console but do not create Sheet rows.
9. Confirm the Google Sheet has a column `H` header such as `call_transcript`; the app writes the captured call transcript there for interested leads.

## 8. Troubleshooting quick list

- `config-ok` fails: check `.env` required keys and file paths.
- Twilio 11200 webhook error: URL not publicly reachable or TLS/DNS issue.
- Web UI works locally but not from your computer: check firewall rules, tunnel/proxy config, and the configured `PORT`.
- No rows in sheet: verify service account has editor access to the sheet tab.
- 500 on webhook: inspect server logs for parsing/sheets errors.

## 9. Context block for starting a new chat

Copy/paste this into a new chat if you want guided setup help from this exact state:

```text
Project: Oak-EagleTwilioBot (Node/Express Twilio outbound bot).
Current status:
- Twilio routes implemented: /twilio/voice/outbound, /twilio/voice/intent, /twilio/voice/contact, /twilio/voice/status
- Campaign runner implemented: POST /campaigns/:id/start
- Web campaign console implemented at GET /
- Web campaign endpoints implemented under /campaigns/ui/*
- Web console supports loop campaigns and a recurring call list with per-lead status
- Web console supports scheduled starts for one-shot and loop campaigns
- Web console supports pausing/resuming running campaigns and cancelling scheduled campaigns
- Web console supports recurring export CSV import, recurring lead removal, transcript viewing, recurring list sorting, and saving/downloading recurring CSV exports
- systemd service helper implemented via npm run service:print and sudo npm run service:install
- Cloudflare Tunnel auto-start implemented through npm start when CLOUDFLARED_AUTO_START=true
- Cloudflare Tunnel status is exposed at GET /system/status and shown in the web console
- Intent parsing + phone extraction + interested-lead Sheets adapter implemented
- Google Sheets appends confirmed interested leads only, with call transcript in column H
- service-account.json exists locally

Need help with:
1) Validating Ubuntu deployment and startup logs
2) Validating Cloudflare Tunnel health for calls.yourdomain.com
3) Twilio webhook wiring and validation calls
4) Optional Docker + Portainer productionization later, if systemd is not enough

Please guide me step-by-step and wait for my confirmation after each step.
```
