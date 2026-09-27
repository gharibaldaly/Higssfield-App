# Higgsfield App — Dr. Secret AI Studio

A private AI production studio for **Dr. Secret**. It turns phone photos of garments into
ghost-mannequin catalogue images and cinematic product video ads. Image and video generation
goes through the **Higgsfield API**; an LLM "director brain" (Claude by default, Gemini as an
alternative) analyses each garment into a **Garment DNA** and writes every prompt and shot list.

Project rules, architecture and the decisions log live in [`CLAUDE.md`](./CLAUDE.md).

## What Phase 1 includes

| Module                 | What it does                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product intake         | Products (SECRET / HOURS / VOWS, 1–3 pieces), phone photos per piece and view, Garment DNA drafted by the director brain and approved by the owner, colourways from swatch photos or an eyedropper.                                                                                                                                                                                           |
| Product Sheet          | 16:9 sheet generated after DNA approval. After approval the app auto-crops isolated references (front, back, six details, pieces/swatch cards), with a crop editor.                                                                                                                                                                                                                           |
| Ghost Mannequin Studio | **From photos** (default): drop the photos of 30+ models at once; the studio groups them, writes each Garment DNA and renders front, back and two close-ups model by model, then colours once fronts are approved. **From products**: the same jobs for existing products. Every result opens in a compare view (original vs result slider) with Approve / Regenerate / Regenerate with note. |
| Ads Director           | Director Board with every control from the brief, the editable "Dr. Secret Cinematic" preset, saved presets, LLM shot planning and per-shot image-to-video generation from isolated references, with an optional preview frame.                                                                                                                                                               |
| Library & Settings     | All generations with filters, favourites and downloads; LLM switch, catalogue style, default and custom models, provider key status, account password, cost summary.                                                                                                                                                                                                                          |

Every generation prompt carries the **PRODUCT LOCK** and **STRICT NEGATIVES** blocks, built by code
from the approved DNA, and uses neutral garment wording.

**Without provider keys the app still works end to end.** A mock image/video provider returns
placeholder results, and a mock director brain returns template DNA and plans. Add keys whenever
they are ready; Settings shows what is configured.

## Stack

Next.js 16 (App Router, TypeScript strict) · Supabase (Postgres + RLS, Storage, Auth) · Tailwind CSS 4 ·
shadcn-style components on Radix · Motion · Lenis (smooth scroll) · raw WebGL for the satin, fluid and
display form · next-intl (Arabic RTL / English) · Vitest · pnpm.

## 1. Supabase

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard). The Frankfurt
   region (`eu-central-1`) is closest to Egypt. Keep it separate from any other system.
2. Run the migrations in `supabase/migrations` in filename order, either:
   - **SQL editor**: paste and run each file (`…_core_schema.sql`, `…_storage.sql`,
     `…_fk_indexes.sql`); or
   - **CLI**: `supabase link --project-ref <ref>` then `supabase db push`.

   This creates the 14 tables with row level security (every row belongs to `auth.uid()`), their
   indexes, and the private `studio` storage bucket, where each user can only touch their own
   folder.

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
| `HIGGSFIELD_MAX_CONCURRENT`                                                                          | recommended       | Requests the Higgsfield account may run at once (console; default 4)     |
| `ANTHROPIC_MODEL`, `GEMINI_MODEL`, `HIGGSFIELD_BASE_URL`, `HIGGSFIELD_MODELS_URL`, `HIGGSFIELD_MOCK` | optional          | Overrides                                                                |
| `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`                                               | Phase 2           | Google Drive mirror                                                      |

Provider keys are only read on the server (route handlers and server actions). Settings shows
configured / missing and never displays a value.

## 3. Deploy on Vercel

1. **Add New → Project**, import this GitHub repository. The framework (Next.js) and pnpm are
   detected automatically. Node.js 22 or 24.
2. Add the environment variables above for Production (and Preview if you use it).
3. Optional: **Settings → Functions → Region** → Frankfurt (`fra1`), next to the database.
4. Deploy. Set `APP_URL` to the production URL and redeploy if you enable webhooks.
5. Sign in with the owner account, then change the temporary password under
   **Settings → Account password** if one was issued to you.

Long operations (garment analysis, copying finished videos into Storage) declare
`maxDuration = 300`, which fits the Hobby plan limit.

## 4. Local development

Requirements: Node.js 22 or 24 and pnpm 10.

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

- The client in `lib/providers/higgsfield/` follows the official API docs (docs.higgsfield.ai,
  API 2.0.0): `https://api.higgsfield.ai`, `Authorization: Key KEY_ID:KEY_SECRET`, submit with
  `POST /{model endpoint}`, then poll the `status_url` it returns (`/requests/{id}/status`).
  Statuses are `queued`, `in_progress`, `completed`, `failed`, `nsfw` and `canceled`; failed and
  nsfw requests are not charged. See the Decisions log in `CLAUDE.md` for what is verified and
  what still needs confirming.
- **Concurrency**: each account may have only so many requests queued or running at once (the
  limit is shown in the Higgsfield console). Set it in `HIGGSFIELD_MAX_CONCURRENT` (default 4).
  Requests beyond it, and requests Higgsfield turns away for a while (full, out of credits, model
  paused, server error), wait in the queue and are sent automatically when there is room; their
  tiles say why they wait. A submit is never repeated after a timeout, because Higgsfield may
  already have accepted it.
- **Model registry**: built-in models, an optional remote catalogue (`HIGGSFIELD_MODELS_URL`)
  and **custom models** added as JSON in Settings, so new models need no redeploy. Each model
  declares its modes, aspect ratios, resolutions, durations and reference-image count, and the UI
  only offers valid options. The built-in list still comes from the older SDK; the current
  catalogue in the console lists different models, which are added from their own docs pages.
- Results are copied into Supabase Storage as soon as they complete (Higgsfield keeps them for at
  least seven days). Front, back and colourway images are trimmed to the garment and re-padded
  with the catalogue margin on the catalogue background, so every product sits the same way in
  the grid.
- Cost or credits are recorded per generation when the API returns them (the documented status
  response has no cost field).
- Every error shown in the studio ends with Higgsfield's reference id (`[ref …]`); give it to
  Higgsfield support together with the request.
- Ghost images from photos need an **image-edit model** (one that keeps the garment from the
  reference photo). The built-in list has none confirmed yet: add the edit endpoint from the
  Higgsfield docs as a custom model in Settings (mode `image-to-image`, reference images as a URL
  list) and pick it for the batch.

## Ghost batches (from photos)

- One folder per model is the easiest way in; the folder name becomes the model name. Colour
  swatches go in a `colours` folder or carry "colour"/"لون" in their name. Without folders the
  studio groups by file name, or in order (N photos per model) for camera names like `IMG_2231`.
- Each model becomes a one-piece product, so its DNA, colourways and images also appear under
  Products and can be used for sheets and ads.
- The work runs **while a studio tab is open**: the browser calls
  `POST /api/ghost-batches/advance` in a loop and the server does one step per call (sort the
  photos, write and approve the DNA, write prompts and submit, settle results, render colours,
  check fidelity). Close the tab and it continues next time the studio is open.

## Project layout

```
app/                 routes (App Router): studio pages, login, setup, API routes
components/          UI: design system (ui/), layout, and one folder per module
lib/                 server logic: domain schemas, providers, prompts, services, actions
lib/prompts/v1, v2/  versioned prompt templates for the director brain
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

1. **Supabase**: اعمل مشروع مستقل (منطقة فرانكفورت)، وشغّل ملفات الـ migrations بالترتيب من SQL Editor.
   بعد كده من Authentication → Users اعمل حساب المالك (Auto Confirm)، واقفل التسجيل الجديد.
2. **Vercel**: اعمل Import للريبو، وضيف متغيرات البيئة (رابط Supabase والمفتاح العام وإيميل المالك)،
   وبعدين Deploy.
3. **المفاتيح**: من غير مفاتيح Higgsfield وClaude/Gemini التطبيق بيشتغل بنتائج تجريبية (Mock).
   لما تضيفها في Vercel وتعمل Redeploy، النتائج الحقيقية بتشتغل على طول.
4. بعد أول دخول غيّر كلمة المرور من **الإعدادات → كلمة مرور الحساب**.
5. **صفحة الجوست من الصور**: اسحب مجلد فيه مجلد لكل موديل (اسم المجلد = اسم الموديل)، وعينات الألوان
   في مجلد «ألوان». الاستوديو يشتغل على الموديلات واحد واحد (أمام، خلف، كلوز)، وبعد ما توافق على الأمام
   يعمل الألوان. الشغل بيمشي طول ما فيه تبويب من الاستوديو مفتوح.
