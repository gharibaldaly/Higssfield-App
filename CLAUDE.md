# Higgsfield App — Project rules for Claude Code

## What this is
A private AI production studio for **Dr. Secret** (Egyptian lingerie, sleepwear and homewear brand; also fragrances). Single user (the owner, Mohamed). It turns phone photos of garments into:
1. **Ghost-mannequin catalogue images** for the Shopify website.
2. **Cinematic product video ads** built through a "director board".
All image/video generation goes through the **Higgsfield API**. An LLM ("the director brain") analyses products and writes prompts/shot lists.

## Non-negotiable product principle
**Garment fidelity is everything.** Any change to a garment detail (lace motif, seam, strap, button count, hem, print scale, colour) causes customer returns. Every feature must protect fidelity:
- Before any generation, the garment is analysed into a **Garment DNA** (structured construction spec) that the user reviews and edits. The DNA is injected into every prompt as a PRODUCT LOCK block.
- Every prompt includes a STRICT NEGATIVES block: no added/removed details, no redesign, no colour shift, no stylisation, no body parts, no visible mannequin/stand/pins.
- Feeding a whole product sheet as a reference distorts fabric. Always pass **isolated, cropped references per shot/detail**.
- Bust areas must render **flat, unlined, unpadded, zero cup projection** unless the DNA says otherwise.
- Use neutral technical wording to avoid content-filter rejections: "invisible display form", "unstructured chest panel", "loungewear", "sleepwear set". Never anatomical wording.
- Every output is shown **side by side with the original photo** (compare view with slider) before it is approved.

## Stack
- **Next.js (latest stable, App Router, TypeScript strict)**, deployed on **Vercel**.
- **Supabase**: Postgres (with RLS), Storage (all inputs/outputs), Auth (email+password, single owner account; RLS by `auth.uid()`).
- **Tailwind CSS + shadcn/ui + Framer Motion**. **next-intl** for Arabic/English with a toggle; Arabic is RTL — use logical CSS properties everywhere (`ms-`, `me-`, `ps-`, `pe-`, `start`, `end`).
- **Render worker** (Phase 2): a separate Node + ffmpeg Docker service in `/worker`, deployed on the owner's existing VPS (Contabo). That VPS runs a production Odoo 17 — the worker must run in its own container with CPU/RAM limits and must never touch Odoo, its database or nginx config beyond a new isolated server block if needed. The worker polls Supabase for render jobs; no inbound ports required.
- Package manager: pnpm. Lint: ESLint + Prettier. Tests: Vitest for lib code.

## Secrets
- Never commit keys. Keep `.env.example` complete and up to date.
- All provider calls (Higgsfield, Anthropic, Gemini, Google Drive) are **server-side only** (route handlers / server actions). Nothing secret reaches the client.
- Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `HIGGSFIELD_API_KEY` (plus secret/ID if their API requires it), `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `APP_OWNER_EMAIL`.

## Higgsfield integration
- **Read the official Higgsfield API documentation before writing the client.** Do not invent endpoints, params or model IDs. If the docs are unreachable from the sandbox, stop that part, write a clear TODO in the Decisions log, and build the adapter against a typed interface + mock so the rest of the app works.
- `lib/providers/higgsfield/`: typed client, model registry, job submit, status polling, result download.
- **Model registry is dynamic**: fetch available image and video models from the API (or a single config file if the API has no listing endpoint). The UI lists **all** available image and video models; each model declares its capabilities (image-to-image, image-to-video, text-to-video, max duration, resolutions, aspect ratios, reference image count) and the UI only shows valid options for the chosen model.
- Generations are async: store a row in `generations` on submit, poll (or webhook if supported), then **copy the result into Supabase Storage immediately** (provider URLs expire). Optional mirror to Google Drive.
- Log cost/credits per generation into `generations.cost` when the API returns it.

## Director brain (LLM)
- `lib/providers/llm/` with one interface (`analyzeGarment`, `buildProductSheetPrompt`, `buildGhostPrompt`, `planAd`, `buildShotPrompt`, `reviewFidelity`) and two implementations: **Claude (Anthropic API)** and **Gemini**. Switchable in Settings; default Claude.
- All prompt templates live in `lib/prompts/` as versioned TypeScript files, not inline strings, so they can be tuned.
- LLM outputs that feed the app are **JSON validated with Zod**.

## Modules

### A. Product intake (shared by both modules)
1. Create a product: name, product line (SECRET = lace & satin, HOURS = homewear/pyjamas, VOWS = bridal), number of pieces (1–3), piece names.
2. Upload phone photos (front, back, details) per piece.
3. LLM produces **Garment DNA** (per piece: category, silhouette, front construction top→bottom, back construction top→bottom, fabrics, lace/print motif description, hardware, colour hex range, "do not alter" list). User edits and approves it.
4. Colourways: add colours per product, each defined by a fabric swatch photo and/or a colour sampled with an eyedropper from a phone photo (store hex + source image).

### B. Ghost Mannequin Studio (catalogue images)
Three job types, each clearly separated in the UI:
- **Front & Back** → exactly 2 images: front and back ghost mannequin.
- **Close-up macro** → exactly 2 images: advertising-grade close-ups that sell the product (lace texture, satin sheen, key detail), chosen by the LLM from the DNA; user can override which details.
- **Colourways** → the approved front image re-rendered in each colourway; only the colour changes, every construction detail identical.
Rules: consistent background, lighting and framing across the whole catalogue (store as a "catalogue style" setting: background colour, aspect ratio default 4:5, padding, shadow). Batch mode: queue multiple products and their colourways in one go; also single-product mode. Every result goes through the compare view (original vs result, slider) with Approve / Regenerate / Regenerate with note.

### C. Product Sheet
Generated after DNA approval; this is the reference used by the ad module. Layout system (landscape 16:9, highest available resolution):
- Warm off-white background `#FAF8F5`, white rounded cards with soft shadows, charcoal headings `#1A1A1A`, grey body text `#666666`, thin gold accent rules.
- **Left column (~37%)**: product title, hero ghost-mannequin front view, short product-overview bullets, back-view card.
- **Right column (~63%)**: 3×2 grid of six macro detail crop cards with small labels; bottom row with two cards (matching pieces / fabric swatches). For multi-piece sets a mandatory card shows all pieces side by side on separate forms, each labelled.
- User approves the sheet. The app then **auto-crops isolated reference images** (each detail card, front, back) and stores them for shot-level use.

### D. Ads Director (video ads)
One screen, the **Director Board**: left = controls, centre = shot list/storyboard with previews, right = video settings.
Director controls (each a visual picker with presets + free text):
camera & lens, visual style, lighting, time of day, room/location, décor & props, colour grading, camera angles, camera movements, where the product appears (bed / chair / wardrobe / flat lay / hanger…), hook type, ad structure, number of shots and duration per shot, mood & music, human model in frame (yes/no).
Video settings: model (all Higgsfield video models), duration, resolution/quality, aspect ratio (default 9:16), per-shot overrides.
Flow: brief (free text) + approved product sheet + controls → LLM plans the shot list (JSON: per shot = purpose, product detail shown, framing, angle, movement, duration, which cropped references to use, prompt) → user edits any shot → generate video per shot directly (image-to-video from the isolated references). Add an optional per-shot "preview frame first" toggle (off by default) for expensive shots. Regenerate single shots without touching the others.
**Default preset "Dr. Secret Cinematic"** (editable, and users can save their own presets):
- 15 s, 9:16, every shot ≤ 3 s, cuts matched to music.
- Real daylight that reveals fabric detail; Sony A7 cinema look; hyper-real fabric motion. Must look like a real global-brand TV commercial — never AI-looking.
- No human model by default.
- Every shot must show an important garment detail; shots that don't show detail are not allowed. Fewest possible shots. Very strong hook in the first shot (paid campaigns).
- Two/three-piece sets follow 3 parts: piece one alone → piece two alone → all pieces together. In the "all together" shot garments lie flat on the bed; never a robe standing upright.
- Environment consistency: same room look and object positions in every shot of one ad (e.g. modern bedroom with bed, chair, wardrobe; product appears once on the bed, once on the chair, once in the wardrobe).
Montage (Phase 2): order/trim clips, upload a music track, render final video via the worker, export.

### E. Library & Settings
- Library: products, DNA, sheets, colourways, all generations with filters, favourites, download.
- Settings: LLM switch, catalogue style, Google Drive connection and target folder, provider key status (configured / missing — never display keys), cost summary.

### Coming soon (show in nav as disabled "Soon" items, no build yet)
UGC ads with a talking character · Fragrance product shots (100 ml rectangular bottle family: Khomra, Midnight Diva, Secret Rose, Harmony, After Dark, Secret Flame, Whisper) · Social posts & carousels · Brand kit · Cost tracking per project (full dashboard).

## UI direction
- **Liquid glass**: translucent frosted panels over a deep, softly moving ambient background; layered depth; smooth spring animations (Framer Motion); subtle specular highlights on glass edges; generous radius. Trendy, "AI studio" feel — not a generic admin dashboard.
- Accent palette drawn from the brand: deep wine `#4D0011`, rose `#CFA8A4`, champagne `#C9A66B`, cream `#F7F3EE`, ink `#111111`. Dark mode is primary; light mode supported.
- Fonts: Arabic — Tajawal or Cairo; English — Jost for UI, Cormorant Garamond for display titles.
- Desktop-first (laptop), but must not break on mobile.
- Must stay fast and readable: glass effects never reduce text contrast below WCAG AA; respect `prefers-reduced-motion`.
- Rich loading states for long generations (progress, elapsed time, queue position), toasts, empty states with guidance.

## Data model (initial)
`products`, `product_pieces`, `source_photos`, `garment_dna` (versioned JSON), `colorways`, `product_sheets`, `reference_crops`, `catalogue_jobs`, `ad_projects`, `director_presets`, `shots`, `generations` (provider, model, params, status, cost, storage_path, error), `render_jobs`, `settings`. All tables have `owner_id` + RLS. Migrations in `supabase/migrations`.

## Roadmap
- **Phase 1 (first session):** scaffold, design system (liquid glass, AR/EN RTL), auth, DB + storage + RLS, Higgsfield adapter + dynamic model registry, LLM adapter (Claude + Gemini), Product intake + Garment DNA, Product Sheet + auto-crops, Ghost Mannequin Studio (all 3 job types, batch + single, compare view), Ads Director board with shot planning and per-shot video generation, Library, Settings.
- **Phase 2:** render worker (ffmpeg) on VPS + montage + music, Google Drive sync, cost dashboard.
- **Phase 3:** coming-soon modules.

## Working rules
- Small, typed, well-named modules; no giant files. Server logic in `lib/`, UI in `components/`, routes in `app/`.
- Every provider call wrapped with retries, timeouts and clear user-facing errors.
- Keep README updated with setup steps (Supabase project, env vars, Vercel deploy, worker deploy).
- Record every non-obvious decision in the Decisions log below.

## Decisions log
- (Claude Code appends here.)

### 2026-09-24 — Phase 1
- **TODO (Higgsfield docs unreachable):** docs.higgsfield.ai and cloud.higgsfield.ai were blocked from the build sandbox (HTTP 403 egress). The transport is taken from the official SDK sources instead (`@higgsfield/client` 0.2.6 on npm, `higgsfield-client` 0.2.0 on PyPI): base `https://api.higgsfield.ai`, header `Authorization: Key KEY_ID:KEY_SECRET`, submit `POST /{model endpoint}` (optional `?hf_webhook=<url>`), status `GET /requests/{id}/status`, cancel `POST /requests/{id}/cancel`, upload `POST /files/generate-upload-url`, statuses `queued | in_progress | completed | failed | nsfw | canceled`, results `images[].url` / `video.url`. Still to confirm against the docs: the full model list and per-model parameters (option lists flagged `verified: false` in `lib/providers/higgsfield/models.ts`, e.g. Flux Kontext / Seedream aspect ratios), which response field carries cost or credits, the webhook payload and whether it is signed, and rate limits.
- **Model registry:** the SDK has no model-listing endpoint, so the registry is a declarative config (`lib/providers/higgsfield/models.ts`) holding only SDK-confirmed models. It can be extended without a redeploy through an optional remote catalogue (`HIGGSFIELD_MODELS_URL`, SDK `ModelSchemasResponse` shape) and custom models entered as JSON in Settings (Zod-validated). Every model declares its modes, aspect ratios, resolutions, durations and reference count; the UI only offers valid options.
- **Mock mode:** with no Higgsfield key (or `HIGGSFIELD_MOCK=1`) a mock provider renders placeholder images with sharp. With no LLM key a deterministic mock brain drafts template DNA and plans. The whole app stays usable before keys exist.
- **Async generations:** a row is stored on submit. Status is polled on read (`/api/generations/status`) with an atomic claim so only one request settles a result. Results are copied into Supabase Storage immediately. An HMAC-signed per-generation webhook URL is used only when `HIGGSFIELD_WEBHOOK_SECRET`, `APP_URL` and the service role key are all configured. Catalogue outputs are padded (never rescaled) to the catalogue aspect ratio with the catalogue background.
- **References:** only isolated crops or single photos are sent, as signed Storage URLs valid for 24 h (so they outlive a provider queue). Request bodies are stored with storage paths instead of signed URLs.
- **Director brain:** a shared `TemplateBrain` owns the prompt templates, Zod validation with one repair retry, and composition. PRODUCT LOCK and STRICT NEGATIVES are appended by code, never by the LLM, and every provider prompt passes the neutral-wording filter. Claude defaults to `claude-opus-5` and streams with Zod structured outputs, with server-side refusal fallbacks enabled (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) for Opus 5 / Fable 5 models. Token caps are generous because thinking counts towards them. Gemini defaults to `gemini-flash-latest` with `responseJsonSchema`, falling back to plain JSON mode if a schema feature is rejected. The chosen provider falls back to the other configured one, then to the mock.
- **Garment DNA:** drafts may contain empty strings so edits save mid-way. Approval is strict: every piece needs a category, front construction, a colour and at least one "do not alter" rule. Chest panels default to unstructured / unlined / unpadded / zero projection.
- **Product sheet:** generated as one 16:9 image from a fixed card geometry (`lib/sheet/layout.ts`) that is described to the model. The same geometry drives the auto-crops, and a crop editor fixes drift before the crops are used. Multi-piece sets always get the "pieces" card first.
- **Ads:** DoP image-to-video exposes no aspect-ratio or duration parameters, so exact 9:16 framing comes from the per-shot "preview frame first" option (a 9:16 frame is generated, approved, then animated). Plans are sanitised: shot length is capped by the preset and unknown reference IDs are replaced with the hero crop.
- **i18n / theme:** next-intl without locale URL segments. The locale lives in the `NEXT_LOCALE` cookie (default Arabic, RTL) and the theme in a `theme` cookie (default dark), so every page renders correctly on the server with no flash.
- **UI:** shadcn-style components are written by hand on the unified `radix-ui` package, because the shadcn registry was unreachable from the sandbox. The `motion` package (Framer Motion's successor, same API) runs with `MotionConfig reducedMotion="user"`. Garment images use plain `<img>` with signed URLs, never Next image optimisation, so the compare view shows the original pixels.
- **Database:** status columns use text + CHECK instead of enums, so states can be added with a constraint swap. The `Database` types are hand-written for precise unions and checked against the generated types. Owner defaults (settings, catalogue style, the "Dr. Secret Cinematic" preset) are seeded by the app on first sign-in, because seeds need `auth.uid()`. Photos upload straight from the browser to Storage, where RLS limits writes to `{owner_id}/…`, instead of going through server actions.
- **Auth:** single owner. Supabase Auth email + password, RLS by `auth.uid()`, an optional server-side `APP_OWNER_EMAIL` lock, and the Next 16 `proxy.ts` session refresh. Sign-ups should be disabled in Supabase. The owner can change the password in Settings.
- **Tooling:** TypeScript 5.9 (typescript-eslint does not support TS 7 yet), ESLint 9 flat config (Next 16 removed `next lint`), Prettier with the Tailwind plugin, and Vitest 5 with `server-only` aliased to a stub.
- **Hosting:** the studio runs on its own Supabase project (`higgsfield-studio`, Frankfurt), in its own organization, fully separate from the `drsecret-ops` orders project, which is never touched. Vercel functions run in `fra1` next to the database.
- **Migrations applied through the Supabase connector** are recorded under the connector's timestamps, so the repo files carry those exact versions (`supabase db push` stays in sync). A follow-up migration adds covering indexes for every foreign key flagged by the performance advisor; the security advisor reports no issues.
- **Supabase keys:** the app uses the new publishable key (`sb_publishable_…`) in `NEXT_PUBLIC_SUPABASE_ANON_KEY`; the legacy anon JWT also works. The secret/service-role key is not readable through the connector, so webhooks stay off (polling covers everything) until the owner adds `SUPABASE_SERVICE_ROLE_KEY` and `HIGGSFIELD_WEBHOOK_SECRET` in Vercel.
- **Owner account:** created directly in `auth.users` / `auth.identities` (email confirmed, bcrypt password via pgcrypto) with a temporary password handed to the owner, who replaces it under Settings → Account password.
