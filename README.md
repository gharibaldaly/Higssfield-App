# Higgsfield App — Dr. Secret AI Studio

A private AI production studio for **Dr. Secret**. It turns phone photos of garments into
ghost-mannequin catalogue images and cinematic product video ads. Image and video generation
goes through the **Higgsfield API**; an LLM "director brain" (Claude by default, Gemini as an
alternative) analyses each garment into a **Garment DNA** and writes every prompt and shot list.

Project rules, architecture and the decisions log live in [`CLAUDE.md`](./CLAUDE.md).

## What Phase 1 includes

| Module                 | What it does                                                                                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product intake         | Products (SECRET / HOURS / VOWS, 1–3 pieces), phone photos per piece and view, Garment DNA drafted by the director brain and approved by the owner, colourways from swatch photos or an eyedropper.                             |
| Product Sheet          | 16:9 sheet generated after DNA approval. After approval the app auto-crops isolated references (front, back, six details, pieces/swatch cards), with a crop editor.                                                             |
| Ghost Mannequin Studio | Front & back, two macro close-ups and colourways; single product or batch queue; every result opens in a compare view (original vs result slider) with Approve / Regenerate / Regenerate with note.                             |
| Ads Director           | Director Board with every control from the brief, the editable "Dr. Secret Cinematic" preset, saved presets, LLM shot planning and per-shot image-to-video generation from isolated references, with an optional preview frame. |
| Library & Settings     | All generations with filters, favourites and downloads; LLM switch, catalogue style, default and custom models, provider key status, account password, cost summary.                                                            |

Every generation prompt carries the **PRODUCT LOCK** and **STRICT NEGATIVES** blocks, built by code
from the approved DNA, and uses neutral garment wording.

**Without provider keys the app still works end to end.** A mock image/video provider returns
placeholder results, and a mock director brain returns template DNA and plans. Add keys whenever
they are ready; Settings shows what is configured.

## Stack

Next.js 16 (App Router, TypeScript strict) · Supabase (Postgres + RLS, Storage, Auth) · Tailwind CSS 4 ·
shadcn-style components on Radix · Motion · next-intl (Arabic RTL / English) · Vitest · pnpm.

## 1. Supabase

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard). The Frankfurt
   region (`eu-central-1`) is closest to Egypt. Keep it separate from any other system.
2. Run the migrations in order, either:
   - **SQL editor**: paste and run `supabase/migrations/20260924120000_core_schema.sql`, then
     `supabase/migrations/20260924120100_storage.sql`; or
   - **CLI**: `supabase link --project-ref <ref>` then `supabase db push`.

   This creates the 14 tables with row level security (every row belongs to `auth.uid()`) and the
   private `studio` storage bucket, where each user can only touch their own folder.

3. Create the owner account: **Authentication → Users → Add user → Create new user**. Enter the
   email and a password, and tick **Auto Confirm User**.
4. Close sign-ups: **Authentication → Sign In / Providers → Allow new users to sign up → off**.
5. Copy the keys from **Project Settings → API Keys**: the project URL, the publishable (anon) key,
   and optionally the secret (service role) key.

The owner's settings, catalogue style and the "Dr. Secret Cinematic" preset are created
automatically on first sign-in.

## 2. Environment variables

Every variable is documented in [`.env.example`](./.env.example).

| Variable                                                                                             | Required          | Purpose                                                                  |
| ---------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`                                          | yes               | Supabase project URL and publishable/anon key                            |
| `APP_OWNER_EMAIL`                                                                                    | recommended       | Only this account can open the studio                                    |
| `APP_URL`                                                                                            | recommended       | Public URL of the deployment (webhook URLs)                              |
| `HIGGSFIELD_API_KEY` (+ `HIGGSFIELD_API_SECRET`)                                                     | for real output   | Higgsfield credentials (`KEY_ID:KEY_SECRET`); mock provider without them |
| `ANTHROPIC_API_KEY` / `GEMINI_API_KEY`                                                               | for real analysis | Director brain; mock brain without them                                  |
| `SUPABASE_SERVICE_ROLE_KEY`, `HIGGSFIELD_WEBHOOK_SECRET`                                             | optional          | Completion webhooks (the app polls without them)                         |
| `ANTHROPIC_MODEL`, `GEMINI_MODEL`, `HIGGSFIELD_BASE_URL`, `HIGGSFIELD_MODELS_URL`, `HIGGSFIELD_MOCK` | optional          | Overrides                                                                |
| `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`                                               | Phase 2           | Google Drive mirror                                                      |

Provider keys are only read on the server (route handlers and server actions). Settings shows
configured / missing and never displays a value.

## 3. Deploy on Vercel

1. **Add New → Project**, import this GitHub repository. The framework (Next.js) and pnpm are
   detected automatically. Node.js 22 or later.
2. Add the environment variables above for Production (and Preview if you use it).
3. Optional: **Settings → Functions → Region** → Frankfurt (`fra1`), next to the database.
4. Deploy. Set `APP_URL` to the production URL and redeploy if you enable webhooks.
5. Sign in with the owner account, then change the temporary password under
   **Settings → Account password** if one was issued to you.

Long operations (garment analysis, copying finished videos into Storage) declare
`maxDuration = 300`, which fits the Hobby plan limit.

## 4. Local development

Requirements: Node.js ≥ 22.12 and pnpm 10.

```bash
pnpm install
cp .env.example .env.local   # fill in at least the two Supabase values
pnpm dev                     # http://localhost:3000
```

| Command                             | What it does                |
| ----------------------------------- | --------------------------- |
| `pnpm lint`                         | ESLint                      |
| `pnpm typecheck`                    | TypeScript (`tsc --noEmit`) |
| `pnpm test`                         | Vitest (library code)       |
| `pnpm format` / `pnpm format:check` | Prettier                    |
| `pnpm check`                        | lint + typecheck + tests    |
| `pnpm build`                        | production build            |

## Higgsfield integration

- The client in `lib/providers/higgsfield/` follows the official `@higgsfield/client` SDK:
  `https://api.higgsfield.ai`, `Authorization: Key KEY_ID:KEY_SECRET`, submit with
  `POST /{model endpoint}`, poll `GET /requests/{id}/status`, cancel
  `POST /requests/{id}/cancel`. The public docs site was unreachable from the build sandbox; see
  the Decisions log in `CLAUDE.md` for what is verified and what still needs confirming.
- **Model registry**: built-in models confirmed by the SDK, plus an optional remote catalogue
  (`HIGGSFIELD_MODELS_URL`) and **custom models** added as JSON in Settings, so new models need
  no redeploy. Each model declares its modes, aspect ratios, resolutions, durations and
  reference-image count, and the UI only offers valid options.
- Results are copied into Supabase Storage as soon as they complete. Provider URLs expire.
- Cost or credits are recorded per generation when the API returns them.

## Project layout

```
app/                 routes (App Router): studio pages, login, setup, API routes
components/          UI: design system (ui/), layout, and one folder per module
lib/                 server logic: domain schemas, providers, prompts, services, actions
lib/prompts/v1/      versioned prompt templates for the director brain
supabase/migrations  database schema, RLS and storage policies
messages/            en.json / ar.json (next-intl)
tests/               Vitest suites for lib code
```

## Phase 2: render worker

The montage renderer (Node + ffmpeg, `/worker`) will run in its own Docker container on the
existing Contabo VPS, with CPU and RAM limits. It polls Supabase for render jobs, needs no inbound
ports, and must never touch the Odoo installation, its database, or its nginx configuration.
The `render_jobs` table is already in the schema.

---

## بالعربي — خطوات التشغيل باختصار

1. **Supabase**: اعمل مشروع مستقل (منطقة فرانكفورت)، وشغّل ملفّي الـ migrations بالترتيب من SQL Editor.
   بعد كده من Authentication → Users اعمل حساب المالك (Auto Confirm)، واقفل التسجيل الجديد.
2. **Vercel**: اعمل Import للريبو، وضيف متغيرات البيئة (رابط Supabase والمفتاح العام وإيميل المالك)،
   وبعدين Deploy.
3. **المفاتيح**: من غير مفاتيح Higgsfield وClaude/Gemini التطبيق بيشتغل بنتائج تجريبية (Mock).
   لما تضيفها في Vercel وتعمل Redeploy، النتائج الحقيقية بتشتغل على طول.
4. بعد أول دخول غيّر كلمة المرور من **الإعدادات → كلمة مرور الحساب**.
