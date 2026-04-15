# Implementation Work Split

This repository is now split so agents can work in parallel with minimal overlap.

## Block A: Telephony Core
- Owner paths: `src/server/*`
- Status: started
- Contract dependencies:
  - `parseInterestIntent(transcript)`
  - `parsePreferredPhone(transcript)`
  - `appendCallOutcome(row)`

## Block B: Intent + Phone Parsing
- Owner paths: `src/intent/*`
- Status: implemented baseline
- Exports:
  - `parseInterestIntent(transcript) -> { intent, confidence }`
  - `parsePreferredPhone(transcript) -> { phoneRaw, phoneNormalized, confidence }`

## Block C: Google Sheets Adapter
- Owner paths: `src/integrations/sheets/*`
- Status: implemented baseline
- Exports:
  - `appendCallOutcome(row)` with retry/backoff and deterministic errors

## Block D: CSV Campaign Runner
- Owner paths: `src/campaigns/*`
- Status: implemented baseline
- Exports:
  - `startCampaign(csvPath, options)`

## Integration Notes
- Current server wiring consumes Blocks B/C/D through stable module imports.
- Remaining work can proceed per block without modifying shared contracts.
