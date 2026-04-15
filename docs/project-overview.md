# Oak & Eagle Twilio Bot Project Overview

This project is a Node.js outbound voice bot for landowner outreach. It starts calls through Twilio from CSV lead lists, plays a natural voice prompt using ElevenLabs-generated audio when configured, asks whether the lead is interested in selling land, captures a preferred callback number from interested leads, and logs final outcomes to Google Sheets.

The current implementation is a focused Phase 1 prototype: CSV in, Twilio calls out, speech gathered by Twilio, simple rules-based parsing, Google Sheets logging, and basic voicemail handling.
It also includes a small web campaign console for uploading CSVs, starting/stopping a campaign, and watching campaign activity from a browser.

## What It Does

At a high level, the bot:

1. Reads lead records from a CSV file.
2. Creates outbound Twilio calls to each lead.
3. Uses Twilio webhooks to control the live call.
4. Plays the opening prompt:

   ```text
   Hi this is Kevin from Oak and Eagle, are you interested in selling your land?
   ```

5. Parses the lead response as `yes`, `no`, or `unknown`.
6. If the lead says yes, asks for the best phone number to reach them.
7. Parses and normalizes the spoken phone number.
8. Ends the call politely.
9. Writes the final call outcome to Google Sheets.

## Tech Stack

- Runtime: Node.js 20+
- HTTP server: Express
- Voice calls: Twilio Node SDK and TwiML
- Speech input: Twilio `<Gather input="speech">`
- Voice audio: ElevenLabs text-to-speech, cached as MP3 files
- Lead input: CSV files
- Outcome storage: Google Sheets
- Config: `.env` loaded through `dotenv`

## Important Files

| Path | Purpose |
| --- | --- |
| `README.md` | Very short quick-start instructions. |
| `run` | Bash wrapper around the campaign CLI. |
| `src/cli/runCampaign.js` | CLI entrypoint for running a CSV campaign. |
| `src/campaigns/csvLeads.js` | Parses and validates lead CSV files. |
| `src/campaigns/startCampaign.js` | Creates outbound Twilio calls from parsed leads. |
| `src/server/app.js` | Express app entrypoint and route mounting. |
| `src/server/routes/twilio.js` | Main call flow, Twilio webhooks, speech handling, voicemail handling, and final logging trigger. |
| `src/server/routes/campaigns.js` | Campaign HTTP endpoints for the web UI and trusted path-based starts. |
| `src/server/campaignManager.js` | In-memory web UI campaign state, upload tracking, activity log, and stop handling. |
| `src/server/public/` | Static browser UI for upload/start/end/monitoring. |
| `src/server/voicePrompts.js` | All spoken prompt text. |
| `src/server/services.js` | Wires Sheets and ElevenLabs services from config. |
| `src/intent/interest.js` | Rules-based yes/no/unknown intent parser. |
| `src/intent/phone.js` | Spoken/digit phone number parser and US E.164 normalizer. |
| `src/integrations/elevenlabs/index.js` | Generates, caches, and serves ElevenLabs prompt audio. |
| `src/integrations/sheets/adapter.js` | Google Sheets append adapter with retry logic. |
| `src/integrations/sheets/schema.js` | Maps call outcomes into sheet row columns. |
| `src/config/index.js` | Loads and validates required environment config. |
| `docs/server-setup-guide.md` | Public URL and server setup guide. |
| `docs/archive/specs.md` | Archived original Phase 1 product/technical spec. |
| `docs/archive/implementation-worksplit.md` | Archived implementation coordination notes. |

## Runtime Flow

### 0. Use The Web Console

When the Express server is running, the campaign console is served from:

```text
GET /
```

Use it to:

1. Upload a lead CSV from your computer.
2. Start the uploaded CSV as a Twilio campaign.
3. End a running campaign.
4. Monitor upload/start/call-create/failure/stop activity.

Uploaded CSV files are stored under:

```text
campaign-inputs/uploads/
```

The web console talks to these endpoints:

```text
GET  /campaigns/ui/state
POST /campaigns/ui/upload
POST /campaigns/ui/start
POST /campaigns/ui/end
```

The UI state is in memory. If the Node process restarts, the page loses the currently uploaded file selection, current campaign status, and activity history.

### 1. Start A Campaign

The easiest way to start a campaign is:

```bash
./run test-lead.csv
```

When only a filename is provided, the CLI resolves it relative to `campaign-inputs/`.

The CLI path:

1. Runs `node src/cli/runCampaign.js`.
2. Resolves the CSV path.
3. Creates a default campaign ID if one is not provided.
4. Calls `startCampaign(csvPath, { config, campaignId })`.

You can also pass an explicit campaign ID:

```bash
./run test-lead.csv test1
```

### 2. Parse CSV Leads

CSV parsing happens in `src/campaigns/csvLeads.js`.

Required columns:

```text
lead_id,lead_phone
```

The CSV must also include either:

```text
lead_name
```

or both:

```text
first_name,last_name
```

Current sample format:

```csv
lead_id,lead_name,lead_phone
1,Jon Riemann,+19493008565
```

Each parsed lead becomes:

```js
{
  lead_id: "...",
  lead_name: "...",
  lead_phone: "..."
}
```

### 3. Create Twilio Calls

Outbound calls are created in `src/campaigns/startCampaign.js`.

For each lead, the app calls:

```js
twilioClient.calls.create({
  to: lead.lead_phone,
  from: config.twilio.fromNumber,
  machineDetection: config.twilio.amdMode,
  asyncAmd: true,
  url: ".../twilio/voice/outbound?...lead context...",
  statusCallback: ".../twilio/voice/status?...lead context...",
  statusCallbackMethod: "POST",
  asyncAmdStatusCallback: ".../twilio/voice/status?...lead context...",
  asyncAmdStatusCallbackMethod: "POST"
});
```

Lead context is attached as query parameters so the webhook can identify the lead later:

```text
lead_id
lead_name
lead_phone
campaign_id
```

Concurrency is controlled by `BATCH_MAX_CONCURRENCY`.

When called by the web UI, `startCampaign` also receives:

```js
shouldStop
onEvent
```

`shouldStop` lets the web UI stop queued leads before they are called. `onEvent` feeds the activity monitor with call creation, call creation failure, and skipped-lead events.

## Twilio Webhook Flow

All Twilio routes are mounted under `/twilio`.

### `POST /twilio/voice/outbound`

This is the first webhook Twilio calls when the outbound call connects.

The route:

1. Collects call context from query/body parameters.
2. Checks whether Twilio identified the answer as a machine.
3. If machine, plays voicemail text and hangs up.
4. If human or unknown, starts a speech gather.

The human path returns TwiML similar to:

```xml
<Response>
  <Pause length="1"/>
  <Gather input="speech" speechTimeout="auto" action="/twilio/voice/intent?...">
    <Play>https://.../twilio/voice/audio/generated-prompt.mp3</Play>
  </Gather>
  <Redirect>/twilio/voice/intent?...</Redirect>
</Response>
```

If ElevenLabs is not enabled, the prompt is spoken with Twilio `<Say>` instead of `<Play>`.

### `POST /twilio/voice/intent`

This route receives the lead's speech transcript in `req.body.SpeechResult`.

It calls:

```js
parseInterestIntent(transcript)
```

Possible parser results:

```js
{ intent: "yes", confidence: 0.9 }
{ intent: "no", confidence: 0.92 }
{ intent: "unknown", confidence: 0.2 }
```

If intent is `yes`:

1. The app stores `interest_intent: "yes"` in memory for the call SID.
2. It asks for the best phone number.
3. It redirects the next speech result to `/twilio/voice/contact`.

If intent is `no`:

1. The app stores `interest_intent: "no"`.
2. It says goodbye.
3. It hangs up.

If intent is `unknown`:

1. The app retries up to `INTENT_MAX_RETRIES`.
2. The retry prompt is:

   ```text
   Sorry, I did not catch that. Are you interested in selling your land, yes or no?
   ```

3. After the retry limit, it treats the result as not interested and ends the call.

The current config enforces `INTENT_MAX_RETRIES=2`.

### `POST /twilio/voice/contact`

This route receives the spoken preferred phone number.

It calls:

```js
parsePreferredPhone(transcript)
```

The parser:

1. Extracts direct digits from the transcript.
2. Converts simple number words to digits.
3. Chooses the longer candidate.
4. Normalizes US numbers to E.164.

Examples:

```text
949 300 8565 -> +19493008565
one nine four nine three zero zero eight five six five -> +19493008565
```

If the number cannot be parsed, the app retries up to `INTENT_MAX_RETRIES`.

The retry prompt is:

```text
I could not capture the number clearly. Please say the best phone number to reach you.
```

After capture or final failure, it says:

```text
Thank you, we will be in touch soon.
```

Then it hangs up.

### `POST /twilio/voice/status`

This route receives Twilio call status callbacks.

It ignores non-terminal statuses such as ringing or in-progress. It only logs to Sheets when the status is terminal.

Terminal statuses:

```text
completed
busy
failed
no-answer
canceled
```

When a terminal status arrives, the app:

1. Looks up the in-memory call state by `CallSid`.
2. Builds the final outcome.
3. Appends one row to Google Sheets.
4. Marks the call SID as finalized.
5. Deletes the temporary in-memory state.

Duplicate terminal callbacks are ignored.

### `POST /twilio/status`

This is an alias for the same status handler. The main expected route is still:

```text
/twilio/voice/status
```

## Voice Prompt System

Prompt text is defined in `src/server/voicePrompts.js`.

Current prompts:

```text
Hi this is Kevin from Oak and Eagle, are you interested in selling your land?
Great, what is the best phone number to reach you?
Thanks for your time. Have a great day.
Sorry, I did not catch that. Are you interested in selling your land, yes or no?
I could not capture the number clearly. Please say the best phone number to reach you.
Thank you, we will be in touch soon.
```

The voicemail prompt comes from:

```env
TWILIO_VOICEMAIL_TEXT
```

## ElevenLabs Integration

ElevenLabs is optional but intended.

The integration is in `src/integrations/elevenlabs/index.js`.

On server startup:

1. `src/server/app.js` calls `warmupVoicePrompts()`.
2. The app builds the full prompt list.
3. ElevenLabs generates MP3 audio for each prompt.
4. Audio is cached under `ELEVENLABS_CACHE_DIR`, defaulting to `.cache/elevenlabs`.
5. The app stores prompt-to-audio URL mappings in memory.

During calls:

1. `addSpeech(...)` checks whether a prompt has an ElevenLabs audio URL.
2. If yes, Twilio receives `<Play>audio-url</Play>`.
3. If no, Twilio receives `<Say>prompt text</Say>`.

The generated audio route is:

```text
GET /twilio/voice/audio/:promptId.mp3
```

This is why `PUBLIC_BASE_URL` must point to a publicly reachable HTTPS domain. Twilio needs to fetch those MP3 URLs from your server.

## Intent Parsing Details

The current intent parser is intentionally simple. It is not an LLM or semantic classifier.

Yes patterns include:

```text
yes
yeah
yep
sure
ok
okay
interested
that works
```

No patterns include:

```text
no
nope
not interested
do not call
stop calling
wrong number
```

If both yes and no patterns appear, or neither appears, the result is `unknown`.

## Phone Parsing Details

The phone parser supports:

- Numeric transcripts: `9493008565`
- Formatted numbers: `(949) 300-8565`
- Basic spoken digits: `nine four nine three zero zero eight five six five`
- `oh` as zero

It normalizes:

```text
10 digits -> +1XXXXXXXXXX
11 digits starting with 1 -> +1XXXXXXXXXX
longer digits starting with 1 -> first 11 digits
```

It does not currently handle more complex speech like:

```text
nine forty-nine three hundred eighty-five sixty-five
```

## Google Sheets Logging

Google Sheets writes happen through `src/integrations/sheets/adapter.js`.

The adapter:

1. Authenticates with a Google service account JSON file.
2. Appends a row to the configured spreadsheet and sheet tab.
3. Retries failed appends up to 3 times with short exponential backoff.

Current row schema is defined in `src/integrations/sheets/schema.js`.

Columns written:

```text
lead_name
lead_phone
preferred_phone
interest_intent
call_status
timestamp_utc
```

This is the actual implemented schema. It is narrower than the original archived spec in `docs/archive/specs.md`, which proposed additional fields like `lead_id`, `call_sid`, `answer_type`, `intent_confidence`, `retry_count`, and notes.

## Outcome Values

### `interest_intent`

The final sheet value is normalized to one of:

```text
yes
no
v/f
```

Meaning:

- `yes`: lead showed interest and went through the preferred-phone path.
- `no`: lead said no, was unclear after retries, did not answer, was busy, or canceled.
- `v/f`: voicemail/failure-style outcome. Failed calls are forced to `v/f`, and machine/voicemail detections use `v/f`.

### `call_status`

The final `call_status` is usually Twilio's terminal status:

```text
completed
busy
failed
no-answer
canceled
```

If machine detection happened, the app writes:

```text
voicemail
```

## Voicemail Handling

Twilio Answering Machine Detection is enabled with:

```js
machineDetection: config.twilio.amdMode,
asyncAmd: true
```

The required AMD mode is:

```env
TWILIO_AMD_MODE=DetectMessageEnd
```

There are two voicemail paths:

1. Immediate machine detection on `/twilio/voice/outbound`.
2. Async machine detection through `/twilio/voice/status`.

If async AMD identifies a machine before the call reaches a terminal status, the app attempts to update the live Twilio call with voicemail TwiML:

```js
twilioClient.calls(callSid).update({
  twiml: voicemailResponse.toString()
});
```

The voicemail text is:

```env
TWILIO_VOICEMAIL_TEXT
```

## Configuration

Config is loaded and validated in `src/config/index.js`.

Required environment variables:

```env
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
PUBLIC_BASE_URL=
TWILIO_STATUS_CALLBACK_URL=
PORT=
SHEETS_SPREADSHEET_ID=
SHEETS_SHEET_NAME=
GOOGLE_SERVICE_ACCOUNT_JSON=
TWILIO_AMD_MODE=DetectMessageEnd
TWILIO_VOICEMAIL_TEXT=
BATCH_MAX_CONCURRENCY=20
INTENT_MAX_RETRIES=2
```

Optional ElevenLabs/Twilio voice settings:

```env
TWILIO_VOICE=
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
ELEVENLABS_MODEL_ID=eleven_flash_v2_5
ELEVENLABS_OUTPUT_FORMAT=mp3_44100_128
ELEVENLABS_CACHE_DIR=.cache/elevenlabs
```

Important validation rules:

- `PUBLIC_BASE_URL` must be a valid `http` or `https` URL.
- `TWILIO_STATUS_CALLBACK_URL` must include a path.
- `GOOGLE_SERVICE_ACCOUNT_JSON` must point to an existing file.
- `TWILIO_AMD_MODE` must be exactly `DetectMessageEnd`.
- `INTENT_MAX_RETRIES` must be exactly `2` for the current project phase.

## HTTP Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/healthz` | Health check. Returns `{ "ok": true }`. |
| `POST` | `/twilio/voice/outbound` | Initial Twilio voice webhook for outbound calls. |
| `POST` | `/twilio/voice/intent` | Handles yes/no speech result. |
| `POST` | `/twilio/voice/contact` | Handles preferred phone speech result. |
| `POST` | `/twilio/voice/status` | Handles Twilio status and AMD callbacks. |
| `POST` | `/twilio/status` | Alias for status callbacks. |
| `GET` | `/twilio/voice/audio/:promptId.mp3` | Serves cached ElevenLabs MP3 prompt audio. |
| `GET` | `/` | Static web campaign console. |
| `GET` | `/campaigns/ui/state` | Returns current web UI campaign state and activity. |
| `POST` | `/campaigns/ui/upload` | Uploads a CSV file from the browser. |
| `POST` | `/campaigns/ui/start` | Starts the uploaded CSV as a background campaign. |
| `POST` | `/campaigns/ui/end` | Requests the running campaign to stop and attempts to end active calls. |
| `POST` | `/campaigns/:id/start` | Starts a campaign from a JSON body containing `csvPath`. |

## Starting The Server

Install dependencies:

```bash
npm install
```

Validate config:

```bash
npm run check
```

Start the server:

```bash
npm start
```

Development mode:

```bash
npm run dev
```

The server listens on:

```env
PORT
```

Open the web console at:

```text
http://SERVER_IP:PORT/
```

For the default local port:

```text
http://SERVER_IP:3000/
```

## Running Campaigns

### Browser UI

1. Start the server with `npm start`.
2. Open `http://SERVER_IP:3000/`.
3. Upload a CSV.
4. Enter an optional campaign ID.
5. Click Start Campaign.
6. Watch the Activity section for call creation and errors.
7. Click End Campaign to stop queued leads and request active calls to hang up.

The End Campaign button is best-effort: it stops leads that have not started yet and calls Twilio to mark active calls as completed. Calls that already finished or cannot be updated by Twilio may still produce normal terminal callbacks.

### CLI

Run a CSV from `campaign-inputs/`:

```bash
./run test-lead.csv
```

Run with an explicit campaign ID:

```bash
./run test-lead.csv test1
```

Equivalent npm command:

```bash
npm run run-campaign -- test-lead.csv test1
```

The CLI prints a JSON summary:

```json
{
  "campaignId": "test1",
  "totalLeads": 1,
  "successCount": 1,
  "failureCount": 0,
  "results": [
    {
      "ok": true,
      "lead": {
        "lead_id": "1",
        "lead_name": "Jon Riemann",
        "lead_phone": "+19493008565"
      },
      "callSid": "CA..."
    }
  ]
}
```

## Starting Campaigns Over HTTP

The server also exposes:

```text
POST /campaigns/:id/start
```

Body:

```json
{
  "csvPath": "./campaign-inputs/test-lead.csv"
}
```

This route resolves `csvPath` with `path.resolve(...)`, so be careful with what callers are allowed to send if this endpoint is ever exposed outside trusted/internal use.

## Public URL Requirement

Twilio cannot call `localhost`. The app needs a public HTTPS URL for:

```text
https://your-domain/twilio/voice/outbound
https://your-domain/twilio/voice/status
https://your-domain/twilio/voice/audio/:promptId.mp3
```

The intended setup in the existing docs is:

- Ubuntu server
- Node app running on local port
- Cloudflare Tunnel exposing the app over HTTPS

See `docs/server-setup-guide.md` for setup notes.

## In-Memory State

During a live call, the Twilio route stores temporary state in memory:

```js
const callOutcomeState = new Map();
const finalizedCallSids = new Set();
const machineRedirectedCallSids = new Set();
```

This state tracks:

- Lead name
- Lead phone
- Preferred phone
- Interest intent
- Machine detection
- Finalized call SIDs

This means active call state is lost if the Node process restarts before the terminal Twilio status callback arrives.

The web UI campaign manager also stores state in memory:

- Uploaded CSV path and lead count
- Current campaign status
- Current campaign ID
- Recent activity log
- Active call SIDs created by the current campaign
- Last run summary

This means the campaign console is operationally useful while the process is running, but it is not a durable campaign database.

For a production-hardening pass, this state should move to persistent storage such as Postgres, Redis, SQLite, or even an intermediate Google Sheet tab.

## Logging

Logs are JSON lines from `src/utils/logger.js`.

Example shape:

```json
{
  "timestamp": "2026-04-15T00:00:00.000Z",
  "level": "info",
  "message": "request.completed",
  "meta": {
    "method": "POST",
    "path": "/twilio/voice/status",
    "statusCode": 204,
    "durationMs": 123
  }
}
```

Errors are written to `stderr`; other log levels are written to `stdout`.

## Current Limitations

- Call state is in memory and not durable across restarts.
- Web UI campaign state and activity history are also in memory and not durable across restarts.
- The web UI and campaign endpoints do not implement authentication yet. Put the app behind a trusted access layer before exposing it broadly.
- The Sheets schema omits some useful audit fields from the original spec, including `lead_id`, `call_sid`, `answer_type`, `retry_count`, and transcript.
- Intent parsing is regex-based and can misclassify nuanced responses.
- Phone parsing only handles simple digit and number-word speech.
- The legacy campaign HTTP endpoint accepts arbitrary resolved CSV paths and should remain internal/trusted unless guarded.
- No explicit calling-hours or compliance enforcement is implemented in this service.
- No automatic redial logic is implemented, which matches the Phase 1 spec.
- ElevenLabs prompt URLs depend on this server being publicly reachable.
- Cached ElevenLabs MP3 files live under `.cache/elevenlabs` and are not part of git.

## Safe Places To Modify

Common changes and where to make them:

| Goal | File |
| --- | --- |
| Change Kevin's script | `src/server/voicePrompts.js` |
| Change voicemail message | `.env` via `TWILIO_VOICEMAIL_TEXT` |
| Add yes/no phrases | `src/intent/interest.js` |
| Improve phone parsing | `src/intent/phone.js` |
| Add more sheet columns | `src/integrations/sheets/schema.js` and `src/server/routes/twilio.js` |
| Change campaign CSV requirements | `src/campaigns/csvLeads.js` |
| Change Twilio dialing options | `src/campaigns/startCampaign.js` |
| Change campaign web UI behavior | `src/server/campaignManager.js`, `src/server/routes/campaigns.js`, and `src/server/public/` |
| Change retry limit behavior | `src/config/index.js` and route logic in `src/server/routes/twilio.js` |

## Practical Debug Checklist

If calls do not start:

1. Check `.env` values.
2. Run `npm run check`.
3. Confirm Twilio credentials and `TWILIO_FROM_NUMBER`.
4. Confirm CSV has required columns and phone numbers are valid.

If the web console does not load from another computer:

1. Confirm `npm start` is running.
2. Open `http://127.0.0.1:PORT/healthz` on the server.
3. Confirm the server firewall allows `PORT`.
4. Confirm any tunnel, reverse proxy, or DNS route points to the Node app.

If Twilio cannot reach the app:

1. Check the public `PUBLIC_BASE_URL`.
2. Open `/healthz` from outside the machine.
3. Confirm Cloudflare Tunnel or public hosting is running.
4. Check Twilio debugger for webhook errors.

If audio does not play:

1. Check `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID`.
2. Confirm startup logs do not show `voice.elevenlabs.pre_generate_failed`.
3. Try opening a generated `/twilio/voice/audio/:promptId.mp3` URL publicly.
4. If ElevenLabs is disabled, Twilio should still fall back to `<Say>`.

If Sheets rows do not appear:

1. Confirm `GOOGLE_SERVICE_ACCOUNT_JSON` points to a real file.
2. Confirm the service account has editor access to the Google Sheet.
3. Confirm `SHEETS_SPREADSHEET_ID` and `SHEETS_SHEET_NAME`.
4. Check logs for `sheets.append.retry` or `SHEETS_APPEND_FAILED`.

If voicemail handling seems odd:

1. Confirm `TWILIO_AMD_MODE=DetectMessageEnd`.
2. Check Twilio callback payloads for `AnsweredBy`.
3. Check logs for `twilio.machine_redirected_to_voicemail`.
4. Remember async AMD can arrive after the call has already begun.

## Future Hardening Ideas

- Persist call state outside process memory.
- Persist campaign run history outside process memory.
- Add call transcript and Twilio call SID to the sheet.
- Add authentication around the web UI and campaign endpoints.
- Add dry-run mode for campaign dialing.
- Add call window and timezone compliance checks before dialing.
- Add structured campaign run records and downloadable summaries.
- Add better phone parsing for natural spoken formats.
- Add Dockerfile and docker-compose setup for the intended Portainer deployment.
