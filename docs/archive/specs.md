# Oak & Eagle Outbound Twilio Bot - Spec v0.1

## 1. Objective
Build an outbound Twilio voice bot that:
1. Calls a landowner lead.
2. Says: "Hi this is Kevin from Oak and Eagle, are you interested in selling your land?"
3. If answer is `yes`: ask for preferred phone number, capture it, and save parsed outcome to Google Sheets.
4. If answer is `no`: thank them and end the call.
5. Use a realistic natural-sounding voice.

## 2. Scope

### In scope (Phase 1)
- Outbound dialing from Twilio number.
- Initial question + yes/no intent detection.
- Preferred phone capture for interested leads.
- Google Sheets logging for parsed outcomes and preferred phone.
- Basic voicemail/answering machine handling.
- Basic retries/fallback prompts.

### Out of scope (Phase 1)
- Advanced CRM integration beyond Google Sheets.
- Full conversational AI with open-ended negotiation.
- Multi-language support.
- Calling-hours/compliance policy enforcement (handled outside this service).

## 3. High-Level Call Flow

### Flow A: Human answers and says yes
1. Bot intro and question.
2. Detect `yes`.
3. Bot asks: "Great, what is the best phone number to reach you?"
4. Capture spoken phone response.
5. Confirm phone number.
6. Save data to Google Sheet.
7. Say: "Thank you, we will be in touch soon."
8. Hang up.

### Flow B: Human answers and says no
1. Bot intro and question.
2. Detect `no`.
3. Bot says: "Thanks for your time. Have a great day."
4. Hang up.
5. Save outcome to sheet as not interested.

### Flow C: Unknown/ambiguous response
1. Bot asks up to `INTENT_MAX_RETRIES` clarifications.
2. If still unclear, mark as `unclear_intent` and end politely.
3. Save outcome.

### Flow D: Voicemail/answering machine
1. Detect machine (Twilio AMD).
2. Leave voicemail script from env config.
3. Save outcome as `voicemail`.

## 4. Technical Architecture

### Components
- `Twilio Voice Webhook Service` (Node.js/Express or equivalent):
  - Generates TwiML for conversation stages.
  - Receives speech results and call status callbacks.
  - Handles state transitions.
- `Intent/Entity Parsing Layer`:
  - Maps transcript to intent (`yes`/`no`/`unknown`).
  - Extracts and normalizes preferred phone number.
- `Google Sheets Adapter`:
  - Appends rows to configured spreadsheet tab.
- `Dialer/Batch Runner`:
  - Starts outbound calls from CSV lead lists.
  - Enforces `BATCH_MAX_CONCURRENCY`.
- `Config & Secrets`:
  - `.env` driven configuration.

### Suggested stack
- Runtime: Node.js + TypeScript.
- HTTP: Express.
- Twilio: official Twilio Node SDK + TwiML VoiceResponse.
- Sheets: `googleapis` SDK (service account).

## 5. Data Model (Google Sheet Columns)

Recommended columns:
1. `timestamp_utc`
2. `lead_id`
3. `lead_name`
4. `lead_phone`
5. `call_sid`
6. `call_status`
7. `answer_type` (`human`, `machine`, `unknown`)
8. `interest_intent` (`yes`, `no`, `unknown`)
9. `preferred_phone`
10. `intent_confidence`
11. `retry_count`
12. `notes`

## 6. Endpoints (Draft)

1. `POST /twilio/voice/outbound`
- Initial Twilio webhook for call answer.
- Returns intro question TwiML with `<Gather input="speech">`.

2. `POST /twilio/voice/intent`
- Handles speech transcript for yes/no.
- Branches to contact capture or polite exit.

3. `POST /twilio/voice/contact`
- Captures preferred phone number.
- Confirms and ends.

4. `POST /twilio/voice/status`
- Twilio status callback endpoint.
- Stores final status updates.

5. `POST /campaigns/:id/start` (internal/admin)
- Starts a batch outbound run from CSV leads.

## 7. Voice Strategy

Goal: natural and trustworthy voice.

Options:
1. Twilio built-in neural voices (fastest to launch).
2. Twilio + Amazon Polly neural voice.
3. Twilio + Google TTS neural voice.
4. Twilio + ElevenLabs (if supported route is approved by team).

Phase 1 decision:
- Use ElevenLabs voice provider.
- Validate quality with sample recordings before production.

## 8. Reliability, Compliance, and Guardrails

- Log consent/rejection outcomes.
- Add rate limits and retries for Sheets writes.
- Graceful fallback if speech confidence is low.
- Store only necessary PII and protect credentials.
- No automatic call retries for no-answer/busy outcomes.

## 9. Implementation Plan (Parallel Agent Blocks)

### Block A - Telephony Core (Agent 1)
- Scope:
  - Implement Twilio webhook routes and TwiML flow states.
  - Add speech gather + retry logic (`INTENT_MAX_RETRIES`).
  - Add AMD handling and voicemail branch.
- Files owned:
  - `src/server/*` Twilio route/controller modules.
- Input contracts:
  - Uses parser interfaces from Block B.
  - Uses sheet logging interface from Block C.
- Output contracts:
  - Stable route handlers:
    - `POST /twilio/voice/outbound`
    - `POST /twilio/voice/intent`
    - `POST /twilio/voice/contact`
    - `POST /twilio/voice/status`

### Block B - Intent + Phone Parsing (Agent 2)
- Scope:
  - Implement yes/no classifier (rules-first baseline).
  - Implement preferred phone extraction and normalization to E.164 where possible.
  - Define confidence thresholds and fallback prompts.
- Files owned:
  - `src/intent/*` and parser tests.
- Input contracts:
  - Receives raw transcript + call context.
- Output contracts:
  - `parseInterestIntent(transcript) -> { intent, confidence }`
  - `parsePreferredPhone(transcript) -> { phoneRaw, phoneNormalized, confidence }`

### Block C - Google Sheets Adapter (Agent 3)
- Scope:
  - Implement Sheets auth and append-row adapter.
  - Map parsed call outcomes to sheet schema.
  - Add retry/backoff and structured error logs.
- Files owned:
  - `src/integrations/sheets/*`.
- Input contracts:
  - Receives normalized event payload from Blocks A/B.
- Output contracts:
  - `appendCallOutcome(row)` async API with deterministic error handling.

### Block D - CSV Campaign Runner (Agent 4)
- Scope:
  - Build CSV lead parser and validation.
  - Build outbound call launcher.
  - Enforce concurrency (`BATCH_MAX_CONCURRENCY`).
  - No automatic retry for no-answer/busy.
- Files owned:
  - `src/campaigns/*`.
- Input contracts:
  - CSV columns: `lead_id`, `lead_name`, `lead_phone`.
- Output contracts:
  - `startCampaign(csvPath, options)` that creates calls and emits run summary.

### Block E - Infra + Runtime (Agent 5)
- Scope:
  - Docker + Portainer runtime setup.
  - Cloudflare Tunnel setup for stable HTTPS endpoint.
  - Container auto-start/restart policies for app and tunnel.
  - Ops runbook and recovery checklist.
- Files owned:
  - `docker-compose.yml`, `Dockerfile`, `docs/deployment.md`, optional `ops/*`.
- Output contracts:
  - Stable public base URL.
  - Boot-persistent services for bot + tunnel via Docker restart policy.

### Block F - QA + Voice Tuning (Agent 6)
- Scope:
  - Create test matrix for yes/no/ambiguous/voicemail scenarios.
  - Tune prompts for conversion and clarity.
  - Validate ElevenLabs voice quality with call recordings.
- Files owned:
  - `docs/test-plan.md`, fixtures under `tests/fixtures/*`.
- Output contracts:
  - Sign-off checklist tied to acceptance criteria.

### Integration order
1. Land Blocks B/C/D in parallel.
2. Land Block A against finalized interfaces.
3. Land Block E for hosted endpoint.
4. Land Block F for end-to-end validation.

## 10. Milestones

1. `M1`: single-call happy path (yes/no branching) works end-to-end locally.
2. `M2`: contact capture + Sheets write complete.
3. `M3`: batch dialing + callbacks + basic observability.
4. `M4`: quality hardening (tests, retries, guardrails, voice tuning).
5. `M5`: pilot rollout with controlled lead segment.

## 11. Acceptance Criteria (Phase 1)

- For human answers:
  - `yes` path captures preferred phone and logs parsed outcome to Sheets.
  - `no` path thanks and ends quickly.
- For voicemail:
  - voicemail message plays and outcome is logged.
- For ambiguous responses:
  - max retries enforced and final outcome logged.
- All calls produce auditable row entries with call SID and outcome.
- No automatic redial occurs after no-answer or busy.

## 12. Decisions Captured

1. Voice provider
- ElevenLabs.

2. Contact capture scope
- Collect preferred phone number only.

3. Lead source/input
- CSV.

4. Compliance rules
- Managed outside this implementation for now.

5. Escalation behavior
- Do not transfer live; capture info and end with follow-up message.

6. Transcript handling
- Store parsed outcomes only (interested/not interested + parsed phone where relevant).

7. Retry behavior
- No automatic retry for no-answer or busy.

8. Credentials ownership
- Twilio and Google credentials are owned/managed by you.

9. Primary pilot KPI
- Interested rate.

## 13. Deployment Target (Chosen)

- Host on Ubuntu home server.
- Run via Docker managed in Portainer.
- Expose service via Cloudflare Tunnel for stable HTTPS URL.
- Keep app and tunnel running via Docker restart policy (`unless-stopped`).

### Required components
1. Ubuntu server with Node.js 20+.
2. Cloudflare-managed domain/subdomain (example: `calls.yourdomain.com`).
3. `cloudflared` installed and authenticated.
4. Docker Engine + Portainer.
5. Twilio webhooks pointed at Cloudflare hostname.

### Target URLs
1. `PUBLIC_BASE_URL=https://calls.yourdomain.com`
2. Voice webhook: `https://calls.yourdomain.com/twilio/voice/outbound`
3. Status callback: `https://calls.yourdomain.com/twilio/status`

### Runtime requirement
- Primary runtime is Docker containers managed by Portainer:
  - `bot` container for Node app.
  - `cloudflared` container for tunnel.
  - Both use restart policy for auto-recovery and reboot persistence.
- `systemd` is optional only if you later choose host-level services instead of containers.

### Deployment runbook (high-level)
1. Build bot Docker image (`Dockerfile`) and define stack in `docker-compose.yml`.
2. Create Cloudflare Tunnel + DNS route (`calls.yourdomain.com -> tunnel`).
3. Add `cloudflared` service in same compose stack with ingress to bot container.
4. Deploy stack through Portainer.
5. Verify both containers are healthy and restart policies are active.
6. Validate `/healthz` over public URL.
7. Update Twilio webhook URLs.
