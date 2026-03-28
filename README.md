# TsuperSaver SMS Middleware (Simple MVP)

Very simple bridge for BlueHacks 2026 Hackathon demo.

It takes SMS-like frames, decodes them, and forwards them using the same body as your online API.

## Online and Offline behavior

- Online mode: app sends HTTP directly to `/api/v1/sms` with `{ sessionId, text }`
- Offline mode: app sends protocol frames over SMS transport
- Middleware decodes the protocol and forwards HTTP to `/api/v1/sms` with the same `{ sessionId, text }`
- Result: backend keeps one contract and one handler for both paths

## Files

- index.js: run modes (simple, mock, optional SMPP)
- middleware.js: bridge logic (decode, forward, optional SMPP send)
- protocol.js: tiny parser/encoder with multipart support
- SPEC.md: product spec

## Protocol format

Each frame is max 160 chars.

Header is fixed 10 chars:

- first 3 chars: part number (001, 002, ...)
- next 3 chars: total parts
- next 4 chars: message ID

Body is key-value text:

```text
s=<sessionId>|x=<text>|p=<json-string>
```

Field meaning:

- `s`: session id (maps to API `sessionId`)
- `x`: command text in your API format (maps to API `text`)
- `p`: optional extra JSON metadata (fallback source)

Full frame example:

```text
001001AB12s=demo-session-1|x=14.577%2C120.99%7C7E|p={}
```

For your API contract, the important key is `x` where `x` follows:

```text
GPS_HEADER|COMMAND
```

Example (before encoding):

```text
x=14.577,120.99|7E
```

In protocol transport, `x` is URL-encoded so `|` and `,` do not break parsing.

Current middleware mapping logic:

- `sessionId` is picked from `s`, then `sessionId`, then `p.sessionId`, then fallback `offline-<timestamp>`
- `text` is picked from decoded `x`, then `text`, then `p.text`, then computed from payload, then fallback `HELP`
- Computed text fallback supports:
  - `p.gps` + `p.command` -> `gps|command`
  - `p.currentLat` + `p.currentLng` + `p.routeCode` -> `lat,lng|routeCode`
  - `p.command` -> `command`

## Inbound JSON sent to backend (same as online mode)

```json
{
	"sessionId": "demo-session-1",
	"text": "14.577,120.99|7E"
}
```

This means your backend can use one endpoint handler for both online and offline traffic.

Example API parity:

- Online request body:

```json
{
	"sessionId": "demo-session-1",
	"text": "14.577,120.99|7E"
}
```

- Offline protocol payload after middleware translation becomes exactly:

```json
{
	"sessionId": "demo-session-1",
	"text": "14.577,120.99|7E"
}
```

## Setup

```bash
npm install
```

This project uses ES modules (`"type": "module"` in package.json).

## Environment variables

- BACKEND_URL (default: http://127.0.0.1:3000/api/v1/sms)
- MOCK_MODE (default: false)
- DEMO_OUTBOUND (default: false)
- USE_SMPP (default: false)
- SMPP_HOST (default: 127.0.0.1)
- SMPP_PORT (default: 2775)
- SMPP_SYSTEM_ID (default: tsupersaver-esme)
- SMPP_PASSWORD (default: password)
- SMPP_SOURCE_ADDR (default: TsuperSaver)

## Run

Simple mode (no SMPP connection):

```powershell
node index.js
```

Simple + mock inbound injection:

```powershell
$env:MOCK_MODE="true"
node index.js
```

Simple + mock inbound + outbound print/send attempt:

```powershell
$env:MOCK_MODE="true"
$env:DEMO_OUTBOUND="true"
node index.js
```

Use real SMPP bind:

```powershell
$env:USE_SMPP="true"
node index.js
```

Note: `startMockSmscServer()` currently logs mock mode only and does not start a real telecom server process.
