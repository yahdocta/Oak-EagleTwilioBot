# Agent Navigation Guide

Use this file as the quick orientation map before changing the project. The full explanation lives in the docs, but this guide tells you where to look first and which files usually matter for each kind of task.

## Start Here

1. Read `docs/project-overview.md` first.
   - Use it to understand what the bot does, the campaign flow, Twilio webhook flow, ElevenLabs audio handling, Google Sheets logging, config, endpoints, known limitations, and safe places to modify.

2. Read `docs/server-setup-guide.md` when the task involves deployment, public URLs, Twilio webhook setup, Cloudflare Tunnel, server startup, or production runtime questions.

3. Only read archived docs for historical context.
   - `docs/archive/specs.md`: original Phase 1 product/technical spec. Some details are stale compared with the implementation.
   - `docs/archive/implementation-worksplit.md`: old parallel-work coordination notes. Useful history, not active instructions.

## Current Active Docs

| Document | Use For |
| --- | --- |
| `docs/project-overview.md` | Main project refresher, architecture, runtime flow, file map, endpoints, config, limitations, debugging checklist. |
| `docs/server-setup-guide.md` | Server setup, public HTTPS URL, Cloudflare Tunnel, Twilio console wiring, deployment troubleshooting. |
| `README.md` | Very quick CLI and web UI startup instructions. |

## Historical Docs

| Document | Status |
| --- | --- |
| `docs/archive/specs.md` | Archived. Original product spec and acceptance criteria; may not match current code exactly. |
| `docs/archive/implementation-worksplit.md` | Archived. Old implementation coordination notes. |

## Codebase Map

| Area | Files |
| --- | --- |
| App entrypoint | `src/server/app.js` |
| Twilio call flow | `src/server/routes/twilio.js` |
| Campaign HTTP endpoints | `src/server/routes/campaigns.js` |
| Web UI campaign manager | `src/server/campaignManager.js` |
| Static web UI | `src/server/public/` |
| Spoken prompts | `src/server/voicePrompts.js` |
| Service wiring | `src/server/services.js` |
| Campaign CLI | `src/cli/runCampaign.js` |
| CSV parsing | `src/campaigns/csvLeads.js` |
| Outbound dialing | `src/campaigns/startCampaign.js` |
| Yes/no parsing | `src/intent/interest.js` |
| Preferred phone parsing | `src/intent/phone.js` |
| Google Sheets adapter | `src/integrations/sheets/adapter.js` |
| Google Sheets row schema | `src/integrations/sheets/schema.js` |
| ElevenLabs TTS/cache | `src/integrations/elevenlabs/index.js` |
| Config validation | `src/config/index.js` |
| JSON logger | `src/utils/logger.js` |

## Common Task Routing

If the user asks to change Kevin's call script:

- Start with `src/server/voicePrompts.js`.
- If voicemail wording changes, check `.env` / `.env.example` for `TWILIO_VOICEMAIL_TEXT`.
- If using ElevenLabs, remember prompts are generated and cached under `.cache/elevenlabs`.

If the user asks about how calls start:

- Read `src/cli/runCampaign.js`.
- Read `src/campaigns/csvLeads.js`.
- Read `src/campaigns/startCampaign.js`.

If the user asks about the web UI:

- Read `src/server/public/index.html`, `src/server/public/app.js`, and `src/server/public/styles.css`.
- Read `src/server/routes/campaigns.js` for upload/start/end/state HTTP routes.
- Read `src/server/campaignManager.js` for background campaign state, activity, and stop behavior.

If the user asks about the live phone conversation:

- Read `src/server/routes/twilio.js`.
- Focus on `/voice/outbound`, `/voice/intent`, `/voice/contact`, and `/voice/status`.

If the user asks about yes/no detection:

- Read `src/intent/interest.js`.
- The current parser is regex-based, not AI-based.

If the user asks about capturing phone numbers:

- Read `src/intent/phone.js`.
- It handles direct digits and simple spoken digit words.

If the user asks about database/logging:

- The "database" is currently Google Sheets.
- Read `src/integrations/sheets/adapter.js`.
- Read `src/integrations/sheets/schema.js`.
- The implemented sheet schema is narrower than the original archived spec.

If the user asks about ElevenLabs voices:

- Read `src/integrations/elevenlabs/index.js`.
- Read `src/server/app.js` for startup prompt warmup.
- Read `src/server/routes/twilio.js` for how `<Play>` is used during calls.

If the user asks about deployment:

- Start with `docs/server-setup-guide.md`.
- Then check `src/config/index.js` for required environment variables and validation rules.

## Operational Notes

- `./run <file.csv> [campaign-id]` starts a campaign from `campaign-inputs/` when only a filename is provided.
- `npm start` runs the Express server.
- `GET /` serves the campaign console.
- `npm run check` validates config by loading `src/config`.
- `npm test` runs the Node test suite.
- Twilio needs a public HTTPS `PUBLIC_BASE_URL`; localhost will not work for live calls.
- Active call state is stored in memory in `src/server/routes/twilio.js`, so restarts during calls can lose temporary state before final status logging.
- Web UI campaign state is stored in memory in `src/server/campaignManager.js`, so restarts lose the console's current upload, activity, and run state.

## Editing Guidelines

- Keep changes focused. This is a compact prototype, so avoid broad refactors unless the user asks for one.
- Do not treat archived docs as source of truth when they conflict with current code.
- Prefer updating `docs/project-overview.md` when behavior changes.
- Preserve existing local/user changes. In this workspace, `run` may have local modifications and `.cache/` may be untracked generated audio.
