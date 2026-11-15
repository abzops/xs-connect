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
| `STT_MODEL` | optional | Sarvam speech model. Default `saaras:v4` |
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
