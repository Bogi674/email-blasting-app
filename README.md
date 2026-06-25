# Email Blast Console

A self-hostable email-blasting platform: build campaigns, manage reusable
templates, connect your own sending accounts (SMTP or SendGrid), upload a CSV
of recipients, personalise with merge variables, and send in bulk. Front end is
static (no build step); the backend is Supabase (auth + Postgres) plus Netlify
Functions for the actual sending.

> **What this is.** A working full-stack app, deployable as-is. It replaces an
> earlier design-only mock-up (which had no inputs, no auth, no database and no
> sending). Everything here is wired to real services.

---

## Architecture

```
Browser (index.html + app.js)
   │  Supabase JS  ── auth, campaigns, templates, accounts, recipients (RLS-scoped)
   │  fetch ───────► Netlify function  /send-blast-background
   │                      │  service-role key (server-only)
   │                      ├─ reads campaign + account + recipients
   │                      ├─ sends via SMTP (nodemailer) or SendGrid
   │                      └─ writes per-recipient + campaign status back
   └─ email footer ─► Netlify function  /unsubscribe  (HMAC-signed suppression)
```

| Layer        | Technology                                   |
|--------------|----------------------------------------------|
| Hosting      | Netlify (static site + functions)            |
| Auth + DB    | Supabase (Postgres, Row Level Security)      |
| Sending      | nodemailer (SMTP) and/or @sendgrid/mail      |
| CSV parsing  | PapaParse (in the browser)                   |

```
.
├── index.html                         # app shell + styles
├── app.js                             # all client logic
├── config.js                          # ← you fill in Supabase URL + anon key
├── netlify.toml                       # publish dir, functions dir, headers
├── .env.example                       # which env vars Netlify needs
├── supabase/schema.sql                # tables + RLS — run once in Supabase
└── netlify/functions/
    ├── send-blast-background.js       # bulk sender (15-min background fn)
    ├── unsubscribe.js                 # unsubscribe link handler
    └── package.json                   # function dependencies
```

---

## Deploy in 5 steps

### 1. Create the Supabase project
1. Go to [supabase.com](https://supabase.com) → **New project**.
2. Open **SQL Editor → New query**, paste the contents of
   `supabase/schema.sql`, and **Run**. This creates every table and the
   row-level-security policies.
3. (Optional) Under **Authentication → Providers → Email**, turn **Confirm
   email** off if you want instant sign-up while testing.
4. Copy two values from **Project settings → API**:
   - **Project URL**
   - **anon public** key (safe to expose)
   - **service_role** key (secret — used in step 4 only)

### 2. Fill in `config.js`
```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT-ref.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-PUBLIC-ANON-KEY",
};
```

### 3. Push to GitHub
```bash
git init
git add .
git commit -m "Email Blast Console"
git branch -M main
git remote add origin https://github.com/YOU/email-blast-console.git
git push -u origin main
```

### 4. Connect Netlify
1. [app.netlify.com](https://app.netlify.com) → **Add new site → Import from
   Git**, pick the repo. Build settings are read from `netlify.toml`
   (publish `.`, functions `netlify/functions`) — leave the build command empty.
2. **Site settings → Environment variables**, add (see `.env.example`):
   - `SUPABASE_URL` — same URL as in config.js
   - `SUPABASE_SERVICE_ROLE_KEY` — the **service_role** key
   - `UNSUBSCRIBE_SECRET` — any long random string (`openssl rand -hex 32`)
3. **Deploy**. Netlify installs the function dependencies automatically.

### 5. Use it
Open the deployed URL, create an account, then:
**Connected Accounts** → add an SMTP mailbox or SendGrid key →
**New blast** → name it, compose, upload a CSV, verify, send.
The dashboard updates as the background sender works through the list.

---

## How sending works

- The browser writes the campaign + recipient rows to Supabase, then calls the
  **background function**. Background functions (the `-background` suffix) return
  immediately and run up to 15 minutes, so large lists don't time out.
- The function verifies the caller's login, loads the recipients still marked
  `pending`, personalises each email by replacing `{{column}}` tokens from the
  CSV, sends it, and records `sent` / `failed` per recipient. A failed batch can
  be re-run from the dashboard's **Retry failed** button.
- Every email gets an auto-appended unsubscribe footer and a `List-Unsubscribe`
  header. Clicking it hits `/unsubscribe`, which verifies an HMAC signature and
  adds the address to that user's suppression list; future sends skip it.

### CSV format
First row is headers. One column is the email address (auto-detected, editable
in the Recipients step). Every other column becomes a merge variable — a column
named `Nama Lengkap` is available as `{{nama_lengkap}}`.

```csv
Email,Nama Lengkap,Perusahaan,Jatuh Tempo
budi@maju.co.id,Budi Santoso,PT Maju Bersama,28 Jun 2026
```

---

## Security notes — read before going live

- **The anon key is meant to be public.** Data is protected by the RLS policies
  in `schema.sql`: a logged-in user can only ever read or write their own rows.
- **The service_role key is secret.** It lives only in Netlify env vars and is
  used solely inside the functions. It is never sent to the browser.
- **Sending credentials** (SMTP password / SendGrid key) are stored in the
  `config` JSON column, readable only by the owning user via RLS and by the
  service-role function. For stricter production use, store them with
  [Supabase Vault](https://supabase.com/docs/guides/database/vault) and read
  them server-side instead of from the table. This is the recommended hardening
  step before handling third-party data at scale.
- **Send responsibly.** Only mail people who have opted in, keep the unsubscribe
  footer, and respect your provider's rate limits and your local anti-spam law.

## Local development
```bash
npm install -g netlify-cli
netlify dev          # serves the static site + functions on localhost
```
Set the same environment variables locally (e.g. in a `.env` file) so the
functions can reach Supabase.

## Common issues
- **"config.js is not filled in"** — you didn't replace the placeholders in
  `config.js`.
- **Send button errors with 404** — functions aren't deployed; confirm
  `netlify/functions` is the functions directory and the deploy succeeded.
- **Emails fail with auth errors** — check the SMTP credentials / SendGrid key,
  and that the from-address is a verified sender with your provider.
- **Sign-up seems stuck** — email confirmation is on; check the inbox or disable
  confirmation in Supabase while testing.
