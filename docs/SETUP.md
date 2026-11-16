# Setting up XS Connect

## 1. Supabase

Project: `xs-connect` in the "xs Ecosystem" organization (`npuhremhnrxxbqckbqrn`, Mumbai).

Apply the migrations in `supabase/migrations/` in order, then deploy the three functions in `supabase/functions/` (`meta-webhook`, `ai-agent`, `send-message`). All three are deployed with JWT verification off: the webhook checks Meta's signature, the other two check the caller's login themselves.

### Secrets (Project Settings → Edge Functions → Secrets)

| Secret | Needed for | Value |
|---|---|---|
| `GEMINI_API_KEY` | AI replies, long voice notes | Paid-tier key from Google AI Studio. The default provider |
| `SARVAM_API_KEY` | voice notes | Key from the Sarvam dashboard. Transcribes voice notes up to 30 seconds with Saaras v4 |
| `ANTHROPIC_API_KEY` | optional | Only if you switch the AI to Claude |
| `AI_MODEL` | optional | Everyday model. Default `gemini-3.5-flash-lite`. A `claude-…` name switches the provider to Anthropic |
| `AI_MODEL_ESCALATION` | optional | Stronger model of the same provider, used when the everyday one fails, e.g. `gemini-3.6-flash` |
| `AI_PROVIDER` | optional | `gemini` or `anthropic`, to force a provider |
| `AI_THINKING_LEVEL` | optional | Gemini thinking level. Default `minimal`, for fast chat replies |
| `META_APP_ID` | one-tap WhatsApp | The XS Connect app's ID in Meta's App Dashboard |
| `META_CONFIG_ID` | one-tap WhatsApp | The Embedded Signup configuration ID (Facebook Login for Business → Configurations, login variation "WhatsApp Embedded Signup") |
| `STT_MODEL` | optional | Sarvam speech model. Default `saaras:v4` |
| `STT_LANGUAGE_HINT` | optional | Language customers mostly speak, for long voice notes read by Gemini. Default `Malayalam` |
| `META_APP_SECRET` | receiving messages | App secret from the Meta app dashboard |
| `META_VERIFY_TOKEN` | webhook setup | Any long random string; type the same one into Meta |
| `META_GRAPH_VERSION` | optional | Graph API version. Default `v24.0`; set it to the version your Meta app uses |
| `APP_ORIGINS` | optional | Comma-separated origins allowed to call the functions. Default covers GitHub Pages for `abzops` and localhost |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided by Supabase.

With only `GEMINI_API_KEY` set, the AI already works on sample chats (Settings → Add sample chats, open a chat, switch on "Type as the customer").

### Auth

In Authentication → URL Configuration, set the Site URL to the app's address (for GitHub Pages: `https://abzops.github.io/xs-connect/`) and add it to the redirect URLs, so confirmation and password-reset emails link back to the app.

## 2. Meta app (pilot: your own accounts)

Messaging your own WhatsApp number, Instagram account and Facebook Page works with standard access, before App Review.

1. Create a Meta app (type Business) at developers.facebook.com and add the WhatsApp, Messenger and Instagram products.
2. Webhooks: callback URL `https://npuhremhnrxxbqckbqrn.supabase.co/functions/v1/meta-webhook`, verify token = `META_VERIFY_TOKEN`. Subscribe to `messages` for each product.
3. In XS Connect → Settings → Connect, add each channel with its ID and access token:
   - WhatsApp: the phone number ID and a system-user token with `whatsapp_business_messaging`.
   - Messenger: the Page ID and a Page access token with `pages_messaging`.
   - Instagram: the Instagram professional account ID and its token with `instagram_business_manage_messages`.

## 3. Serving other brands

Requires Meta Business Verification of Xelorsoft and App Review for advanced access to the messaging permissions, then Embedded Signup in the app (not built yet). Start the verification early; it does not depend on code.

## 4. GitHub Pages

`.github/workflows/pages.yml` tests, builds and pushes `dist/` to the `gh-pages` branch on every push to `main`. In the repository settings, set Pages to deploy from the `gh-pages` branch.

## Deploying the edge functions

Each function's `index.ts` is deployed on its own. Its imports of `../_shared/*.ts` are replaced with links to the same files in this repository, pinned to one commit:

`https://raw.githubusercontent.com/abzops/xs-connect/<commit>/supabase/functions/_shared/<file>.ts`

To release a change to shared code: push it, then redeploy the functions with the new commit id in those links. The repository has to stay public for this to work; with a private repository, deploy with the Supabase CLI instead (`supabase functions deploy`).

## Connecting a customer's channel

Customers see three big buttons (WhatsApp, Instagram, Facebook Messenger).

- **WhatsApp, one tap:** once `META_APP_ID`, `META_CONFIG_ID` and `META_APP_SECRET` are set, the customer taps "Connect WhatsApp", logs in with Facebook and scans a QR code in the WhatsApp Business app. Their number stays on their phone (Meta's coexistence mode). This needs Xelorsoft's Meta app to be approved as a Tech Provider.
- **Call me:** until then, and for Instagram and Messenger, the customer leaves a phone number. Requests appear in the `setup_requests` table (Supabase → Table Editor). Call them and connect the channel with the developer form; the request closes itself when the channel connects.
- **For developers:** the old ID-and-token form is under a link at the bottom of the screen.
