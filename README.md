# XS Connect

WhatsApp, Instagram and Facebook Messenger in one inbox, answered by an AI that knows the brand: it replies, captures the lead, takes the order, follows up, and hands over to a person when it should. By Xelorsoft, built on the same stack and design system as XS Gym.

- App: React 19, Vite, TypeScript. Hosted on GitHub Pages.
- Backend: Supabase (Postgres with row level security, Edge Functions, Realtime), Mumbai region.
- AI: Google Gemini by default, Anthropic optional, behind a small model router (`supabase/functions/_shared/llm.ts`). Voice notes are transcribed with Sarvam Saaras, with Gemini as the fallback (`_shared/voice.ts`).

## How it fits together

```
Meta (WhatsApp / Instagram / Messenger)
   │  signed webhook
   ▼
meta-webhook ──► service_ingest (contact, conversation, message, lead)
   │                                   │ Realtime
   ▼                                   ▼
runAgent ──► model + tools ──► service_ai_reply      Inbox in the app
   │            (search_knowledge, update_lead,          │ staff reply / approve draft
   │             create_order, schedule_followup,        ▼
   │             handoff_to_human)                   staff_send_message ──► send-message
   ▼                                                                         │
deliver ──► Meta send API ◄──────────────────────────────────────────────────┘
```

Rules the code enforces:

- Every write goes through a database command function that checks permission. API roles can only read, through RLS. Edge functions use `service_*` functions that only the service role may call.
- Order totals come from the price list in the database, never from the model.
- The AI replies on its own by default (`autopilot = true`). A brand can switch approval on, and then the AI writes drafts that a person sends.
- The AI may reply only inside Meta's 24 hour window. After that, a person may reply on Instagram and Messenger for up to 7 days (Human Agent tag); WhatsApp needs an approved template.
- The webhook fails closed: no `META_APP_SECRET`, or a bad signature, and nothing is accepted.
- Usage is metered once per customer per day (one "AI conversation"), free trial first, then the wallet.

## Run locally

```bash
cp .env.example .env.local   # fill in the Supabase URL and publishable key
npm ci
npm run dev
```

Checks: `npm run typecheck`, `npm run lint`, `npm test`, and `bash tests/db/run.sh` (needs PostgreSQL 16; set `PG_RUN_AS` to a non-root user when running as root).

## Set up a project

See [docs/SETUP.md](docs/SETUP.md) for the Supabase secrets, the Meta app, and connecting the first channel.

## Status

Working: sign-in, brand setup, sample chats, inbox with live updates, draft approval, AI on/off per chat, leads, orders, follow-ups, Brand Brain, analytics, manual channel connection, webhook gateway, AI agent, delivery.

Not built yet: one-tap Meta login (Embedded Signup; needs Meta App Review), WhatsApp templates for follow-ups outside the window, voice-note transcription, payment links and wallet recharge (Razorpay), appointment slots, team invites.
