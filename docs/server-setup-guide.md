# Oak & Eagle Twilio Bot: Server + Public URL Setup Guide

This guide starts from an unconfigured server and gets you to a working public webhook URL for Twilio.

## 1. What this project needs

Your app must be reachable over HTTPS on:

- `https://<your-domain>/twilio/voice/outbound`
- `https://<your-domain>/twilio/voice/status`

Twilio cannot call `localhost`, so you need a public URL. The intended setup in your spec is:

- Ubuntu home server
- Docker + Portainer
- Cloudflare Tunnel

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

# Fill these after tunnel/domain is live:
PUBLIC_BASE_URL=https://calls.yourdomain.com/
TWILIO_STATUS_CALLBACK_URL=https://calls.yourdomain.com/twilio/voice/status
```

3. Keep `service-account.json` out of git (already handled in `.gitignore`).

## 4. Bring up app on Ubuntu server

Use one of these paths:

- Path A (quick): run Node directly with PM2/systemd.
- Path B (recommended): Docker container (better for your target architecture).

### Path A: quick Node runtime

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

App should answer `GET /healthz` on `http://localhost:3000/healthz`.

### Path B: Docker runtime (recommended)

If you want, start a new chat and ask me to generate `Dockerfile` + `docker-compose.yml` for this repo.  
This is not fully added yet in the codebase.

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

6. Run tunnel:

```bash
cloudflared tunnel run oak-eagle-bot
```

7. Validate:

- `https://calls.yourdomain.com/healthz` should return `{ "ok": true }`

## 6. Finalize Twilio settings

In Twilio Console for your phone number (Voice webhook):

- Voice URL: `https://calls.yourdomain.com/twilio/voice/outbound`
- HTTP Method: `POST`
- Status callback URL: `https://calls.yourdomain.com/twilio/voice/status`
- Status events: initiated, ringing, answered, completed

## 7. Run first end-to-end test

1. Start app.
2. Start cloudflared tunnel.
3. Trigger campaign endpoint with a tiny CSV (1-2 leads).
4. Confirm rows are appended to your Google Sheet.

## 8. Troubleshooting quick list

- `config-ok` fails: check `.env` required keys and file paths.
- Twilio 11200 webhook error: URL not publicly reachable or TLS/DNS issue.
- No rows in sheet: verify service account has editor access to the sheet tab.
- 500 on webhook: inspect server logs for parsing/sheets errors.

## 9. Context block for starting a new chat

Copy/paste this into a new chat if you want guided setup help from this exact state:

```text
Project: Oak-EagleTwilioBot (Node/Express Twilio outbound bot).
Current status:
- Twilio routes implemented: /twilio/voice/outbound, /twilio/voice/intent, /twilio/voice/contact, /twilio/voice/status
- Campaign runner implemented: POST /campaigns/:id/start
- Intent parsing + Sheets adapter implemented
- service-account.json exists locally
- I do NOT have server deployment/public URL configured yet

Need help with:
1) Ubuntu deployment steps
2) Cloudflare Tunnel setup for calls.yourdomain.com
3) Twilio webhook wiring and validation calls
4) Optional Docker + Portainer productionization

Please guide me step-by-step and wait for my confirmation after each step.
```
