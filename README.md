# Oak-EagleTwilioBot
Oak &amp; Eagle automated outbound twilio bot.

## Project overview

This project is a Node.js outbound voice bot for Oak & Eagle landowner outreach.
It starts phone calls through Twilio from CSV lead lists, asks whether the person
is interested in selling their land, collects a preferred callback number from
interested leads, and writes interested leads to Google Sheets.

The current app is a focused Phase 1 prototype. It uses CSV files as campaign
input, Twilio for outbound calling and speech capture, simple rule-based parsing
for yes/no answers and spoken phone numbers, optional ElevenLabs-generated audio
for natural voice prompts, and Google Sheets as the interested-lead log.

It also includes a small browser campaign console. From the web UI, you can
upload a CSV, start a campaign immediately or schedule it for a chosen date,
time, and time zone, optionally run the campaign in a recurring loop, pause or
end a running campaign, monitor campaign activity, sort and manage the recurring
call list, inspect call transcripts, export remaining recurring leads, and check
the Cloudflare Tunnel status.

At a high level, the call flow is:

1. Read leads from a CSV file.
2. Create outbound Twilio calls for each lead.
3. After a 1-second pause, play the opening prompt: "Hi this is Kevin from Oak and Eagle, are you interested in selling your land?" If the lead includes a valid city, the prompt becomes: "Hi this is Kevin from Oak and Eagle, are you interested in selling your land in Asheville?"
4. Parse the lead's response as `yes`, `no`, or `unknown`.
5. If the lead is interested, ask for the best phone number to reach them.
6. Parse and normalize any usable US phone number from the spoken response.
7. End the call politely.
8. Append confirmed interested leads to Google Sheets with the call transcript.
9. In loop mode, keep unresolved/no-answer leads in the recurring call list and
   remove leads that confirmed interest or clearly declined.

The app is intentionally lightweight and mostly in-memory. Active call state,
web UI campaign state, upload selection, and activity history are lost if the
Node process restarts. Before exposing it broadly, put the web UI and campaign
endpoints behind a trusted access layer.

## Run a CSV campaign quickly

Put CSV files in `campaign-inputs/`, then run:

```bash
./run leads.csv
```

Optional campaign id:

```bash
./run leads.csv test1
```

Lead CSVs must include `lead_id`, `lead_phone`, and either `lead_name` or both
`first_name` and `last_name`. To personalize the opening question by city, add
one optional city column: `lead_city`, `city`, `property_city`, `situs_city`,
`site_city`, or `mailing_city`. To log the property address, add one optional
address column: `lead_address`, `address`, `property_address`, `situs_address`,
`site_address`, or `mailing_address`.

DealMachine exports can be uploaded from the web UI by checking the
`Deal Machine CSV` option before upload. The server converts DealMachine columns
such as `contact_id`, `associated_property_address_full`, `first_name`,
`last_name`, and `phone_1`/`phone_2`/`phone_3` into the app's campaign CSV
format. It skips `Wireless Excluded` phone values, picks the first usable phone,
normalizes US numbers, keeps the property address, and derives `lead_city` from
full addresses like `Eliot Ln, Albrightsville, Pa 18210`. If an address field
contains only a city-like value such as `laguna beach`, the opening question can
use that value as the city.

Recurring call list exports can be uploaded back into the web UI by checking
`Recurring export CSV`. The importer keeps dialable rows, drops closed statuses
such as `logged`, `declined`, and `removed`, and converts the file back to the
normal campaign CSV columns.

## Web UI

Start the server:

```bash
npm start
```

Or use Docker (if already installed):

```bash
docker-compose up -d
docker-compose logs -f oak-eagle-bot
```

The server also starts the configured Cloudflare Tunnel by default, using `~/.cloudflared/config.yml`.

To keep the bot running 24/7 after closing VS Code or SSH, use either:

**Option 1: systemd (Node.js runtime)**
```bash
Ctrl+C # stop any manual npm start process first
npm run service:print
sudo npm run service:install
```

Then inspect logs with:

```bash
journalctl -u oak-eagle-twilio-bot -f
```

**Option 2: Docker + docker-compose**
```bash
docker-compose up -d              # Start
docker-compose logs -f oak-eagle-bot  # View logs
docker-compose restart            # Restart
```

For full deployment and troubleshooting, see [docs/server-setup-guide.md](docs/server-setup-guide.md).

Open the campaign console:

```text
http://SERVER_IP:3000/
```

Use the page to upload a normal campaign CSV, checked `Deal Machine CSV`, or
checked `Recurring export CSV`, start a one-shot or looping campaign immediately,
schedule a one-shot or looping campaign for later, pause/resume a running
campaign, cancel a scheduled campaign, end a running campaign, monitor activity,
view and sort the recurring call list, remove individual recurring leads, inspect
captured transcripts, save/download recurring CSV exports, and check Cloudflare
Tunnel status. If you are accessing it from another computer, make sure the
server firewall allows the configured `PORT`.

In loop mode, no-answer/unresolved leads stay in the campaign and are called
again after the configured interval. Leads that clearly say no are marked
declined and removed. Leads that confirm interest are logged to Google Sheets,
marked logged, and removed.

Saved recurring CSV exports are written under `campaign-inputs/exports/`.
