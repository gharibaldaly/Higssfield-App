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
- Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `HIGGSFIELD_API_KEY` (plus secret/ID if their API requires it), `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `LLM_GATEWAY_BASE_URL` + `LLM_GATEWAY_API_KEY` + `LLM_GATEWAY_MODEL` (optional gateway brain), `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `APP_OWNER_EMAIL`.

## Higgsfield integration
- **Read the official Higgsfield API documentation before writing the client.** Do not invent endpoints, params or model IDs. If the docs are unreachable from the sandbox, stop that part, write a clear TODO in the Decisions log, and build the adapter against a typed interface + mock so the rest of the app works.
- `lib/providers/higgsfield/`: typed client, model registry, job submit, status polling, result download.
- **Model registry is dynamic**: fetch available image and video models from the API (or a single config file if the API has no listing endpoint). The UI lists **all** available image and video models; each model declares its capabilities (image-to-image, image-to-video, text-to-video, max duration, resolutions, aspect ratios, reference image count) and the UI only shows valid options for the chosen model.
- Generations are async: store a row in `generations` on submit, poll (or webhook if supported), then **copy the result into Supabase Storage immediately** (provider URLs expire). Optional mirror to Google Drive.
- Log cost/credits per generation into `generations.cost` when the API returns it.

## Director brain (LLM)
- `lib/providers/llm/` with one interface (`analyzeGarment`, `buildProductSheetPrompt`, `buildGhostPrompt`, `planAd`, `buildShotPrompt`, `reviewFidelity`) and two implementations: **Claude (Anthropic API)** and **Gemini**. Switchable in Settings; default Claude. At the owner's request (2026-09-27) a third option runs the brain through an **OpenAI-compatible gateway** the owner subscribes to (base URL, key and model in env/Settings).
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

**Batch from photos** (the Ghost page's default view, added 2026-09-27 at the owner's request): the owner drops the photos of many models (30 or more) without creating products first. The studio works through them one by one: stage 1 is front, back and two close-ups for every model; stage 2 renders the colours once the owner approves the fronts. White background, one house style for every image, and prompts that keep every detail of the model. The product-based studio stays under "From products".

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
Redesigned on 2026-09-26 at the owner's request (new layout, colours, style, motion and effects), then pushed closer to sloshseltzer.com's motion and scroll the same day (see the Decisions log).
- **Satin atelier**: the studio feels like a couture workroom, not an admin dashboard and not a generic AI look. A deep emerald shot-satin background (WebGL shader) moves behind near-opaque "tulle" panels. The signature is a WebGL point-cloud display form (seam rings, princess seams, stand) on the home hero, sign-in and the index menu. Motifs come from the trade: woven labels, a work ticket, pinked swatches, tech-pack sections, film slates and a film strip with timecodes, a contact sheet with grease-pencil rings, hang tags.
- Palette. Dark (primary): emerald `#031512` / `#082620` / `#0E3229`, pearl `#F3EFE8`, mist `#A9BDB5`, blush `#FFB8CB`, veil rose `#FF6A9A`. Light: blush tissue `#F9E1E7`, emerald ink `#062A22`, emerald `#0E5C49`. Product-line labels keep fixed colours in both themes (SECRET blush, HOURS mint, VOWS pearl).
- Garment images always sit on a neutral grey stage (`#242424` dark / `#D4D4D4` light) with crop marks, never on a tinted surface, and no effect ever touches their pixels.
- Fonts: Arabic titles — Aref Ruqaa; English titles and Latin numerals — Gloock; UI — IBM Plex Sans + IBM Plex Sans Arabic; labels and data — IBM Plex Mono.
- Layout: a sticky masthead (wordmark, section links, preferences) and a full-screen index overlay; pages open with a large display title and a drawn seam.
- Motion (after sloshseltzer.com), kept on the decorative layer:
  - **Scroll:** weighted smooth scrolling (Lenis) over native scroll; display titles lean with the scroll speed.
  - **Page transitions:** a liquid pour between sections — two wavy layers of satin rise, the page loads underneath, and the liquid runs off.
  - **Titles:** fill like a glass behind a rising wavy line.
  - **Satin:** swirls behind the cursor (a fluid simulation) and sloshes with the scroll.
  - **Home:** stickers and hand-drawn doodles; the SECRET · HOURS · VOWS colour bands slide with the scroll while the display form crosses them.
  - **Page chrome:** lists slide into view, and side rails carry a stitched scroll thread.
- Motion stays CSS-first wherever it can (scroll-driven animations included), so pages render finished on the server. The "FX" toggle (cookie) and `prefers-reduced-motion` turn the decorative layer into still frames and plain scrolling.
- Desktop-first (laptop), but must not break on mobile. Text keeps WCAG AA on every surface and on the satin itself.
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

### 2026-09-25 — UI/UX review
- **Method:** the UI/UX Pro Max skill (`ui-ux-pro-max-cli` 2.15.0) was installed only in the working session and is not committed, because its README says CC-BY-NC-4.0 while its `package.json` says MIT. Its design-system output confirmed the Liquid Glass direction and the black-and-gold luxury palette; the palette and fonts in this file stay authoritative. A Playwright + axe-core audit (WCAG 2.2 AA plus best practices) of 12 pages × dark/light × ar/en × desktop/mobile on production found no contrast, overflow or console problems, and 10 rule violations that this review fixes.
- **Glass and rings:** the `glass` utilities are emitted after Tailwind's ring and border utilities, which silently hid selection rings and warning borders on glass surfaces. Glass now folds the ring variables into its box-shadow, and tinted edges go through `--glass-border` (`glass-warning`) instead of `border-*` classes.
- **Confirmations:** `useConfirm()` (`components/common/confirm-dialog.tsx`) replaces every `window.confirm` with a glass alert dialog in the current language and direction; Cancel is focused first.
- **Headings:** `CardTitle` renders an h2 by default (`as` for nested cards), so pages go h1 → h2 → h3 without skipped levels.
- **Arabic typography:** letter-spacing is reset under `lang="ar"` because tracking breaks joined letters. The smallest labels are 11px and eyebrow labels 12px.
- **Resilience:** glass becomes a solid panel under `prefers-reduced-transparency` or without backdrop-filter support. The browser theme colour follows the theme cookie. A skip link jumps to `#main`, and enabled buttons get the pointer cursor that Tailwind 4 removed.

### 2026-09-26 — Redesign: satin atelier
- **Why:** the owner asked to change the layout, colours, style, motion and effects entirely, to something visually striking and unlike typical AI-made interfaces, with ideas from lamalama, floema, bruno-simon, oryzo, landonorris, thelinestudio, davidwhyte/experience, sloshseltzer and igloo. The UI direction above replaces liquid glass and the wine/champagne palette. Those looks sit close to two generic AI defaults (cream and serif, near-black with one accent). The references share WebGL heroes, huge type, mono labels and custom cursors. The new direction takes those techniques and grounds every motif in the atelier. Blush keeps a tie to the brand's rose.
- **Panels without blur:** the satin moves all the time, and backdrop blur behind every card would redraw every frame. Panels are near-opaque instead. Only floating layers (masthead, menus, dialogs, the index) blur.
- **WebGL:** raw WebGL 1, no three.js. The satin renders at half resolution and 30 fps, and its brightest sheen is capped by the `--satin-*` palette so text on it keeps AA. The form's geometry is a pure, seeded, tested module (`lib/fx/ghost-form-geometry.ts`). Each mount creates its own canvas and releases its context on unmount, so remounts never pile up contexts or make the browser drop the background's. Canvases pause off-screen (IntersectionObserver) and in hidden tabs, and draw one still frame when effects are calm. Without WebGL the flat background shows.
- **Effects preference:** an `fx` cookie (`full` / `calm`), read on the server into `html[data-fx]` like theme and locale, so nothing flashes. `prefers-reduced-motion` always wins.
- **Motion in CSS:** the veil, reveals, stitches, odometers, staggers and the index circle are CSS animations. Each rule only describes where an element starts, so without animation (calm, reduced motion, no JS) everything is already in place.
- **Arabic:** Ruq'ah only for page titles and the hero; section and card titles use Plex Sans Arabic semibold. Mono labels switch to Plex Sans Arabic in Arabic, because the mono space would pull Arabic words apart. `font-synthesis: none` stops faux bold on the single-weight display faces.
- **Garment fidelity:** every garment image (photos, results, compare view, crops) sits on the neutral grey stage. The contact sheet and film strip use a neutral `#151515` film base in both themes. Decoration never overlaps garment pixels beyond corner crop marks and the grease-pencil ring around approved frames.
- **Navigation:** the sidebar became a masthead with short labels (`nav.short.*`) and a full-screen index with full names, one-line hints (`nav.hint.*`) and the coming-soon modules. The home page also runs the coming-soon modules as a ticker.
- **Verification (preview):** a Playwright run seeded one test product through the real flows (mock providers), visited every page 57 times across dark/light × ar/en × desktop/phone with effects on, then deleted the product. It found no console errors and no horizontal overflow. axe (WCAG 2.2 AA plus best practices) flagged only light-mode contrast on dimmed labels, since fixed (no text is dimmed below 85% now). The same run caught two bugs, both fixed: a Latin title inside an Arabic page rendered its words in reverse order (each word is an inline-block; the run is now an explicit LTR span), and garment photos that finished loading before hydration stayed invisible behind the fade-in (the image now reads its own `complete` state on mount).

### 2026-09-26 — Motion pass after sloshseltzer.com
- **Why:** the owner asked for the studio to feel closer to sloshseltzer.com in effects, visual impact, animation and scroll.
- **Research:** the site is one WebGL canvas (Buttermax, Hydra framework), and its GPU blocklist rejects SwiftShader. It was captured in a Vercel sandbox with a spoofed `WEBGL_debug_renderer_info`, and its `app.js` was read. What it does:
  - **Scroll:** virtual scroll (`lerp 0.1`).
  - **Pour:** a can pours liquid that floods each section in a new colour.
  - **Type:** huge outlined type that fills with liquid.
  - **Mouse:** a fluid simulation (`sim 128, dye 512, velocity 0.98, density 0.97, pressure 0.8, curl 30`).
  - **Bands:** flavour bands a 3D can rolls across.
  - **Decoration:** stickers, doodles and side labels.
  - Each of these was mapped to an atelier equivalent. Garment images are never touched.
- **Smooth scroll:** Lenis 1.3.26 (MIT), only with full effects and a fine pointer. It glides over native scroll, so sticky elements, keyboard scrolling and CSS scroll timelines keep working.
  - It stops while Radix locks the page (`body[data-scroll-locked]`).
  - Dialogs, menus, listboxes and popovers scroll natively (`prevent`, `allowNestedScroll`).
  - One loop publishes offset, speed and progress (`components/fx/scroll-store.ts`), which the fluid, the forms, the ticker and the `.fx-skew` titles read.
- **Liquid transition** (replaces the CSS veil):
  - A capture-phase click listener runs before Next's `Link`, which then sees `defaultPrevented`.
  - Liquid covers the page, and `router.push` fires at 80% of the cover. The liquid runs off when the pathname changes, with a 6 s safety drain.
  - It only pours when the section or the item changes (`shouldPour`). Tabs and filters stay instant.
  - Sign-in pours on submit and drains back on an error.
- **Liquid titles:**
  - **Mask:** the fill is masked by a wave image three title-heights tall, so at rest (no animation, calm mode) the title is solid.
  - **Latin ghost:** an outline. `-webkit-text-fill-color: transparent` keeps `currentColor` for the stroke.
  - **Arabic ghost:** a faint copy instead, because outlines expose the joins.
- **Fluid satin:** a stable-fluids solver in the satin's own WebGL context. It prefers WebGL 2, falls back to WebGL 1 half floats, and stays off without them.
  - The velocity drags the folds; the dye lifts ridges and tints within the capped satin palette, so text on the satin keeps AA.
  - It rests after 5 s without input and runs only with a fine pointer.
  - It lives only in the background layer, never over garment images.
- **Scroll-driven CSS:** `animation-timeline: view()/scroll()`, guarded by `@supports`, full effects and `prefers-reduced-motion: no-preference`.
  - Lists only slide in (no tilt or scale), because they hold garment images.
  - `page-in` now animates the `translate` property, so it composes with scroll-driven `transform`s.
- **Bands:** fixed product-line colours in both themes. The sticky form eases between tones (`GhostForm tone`), and the bands use `overflow-x: clip` so their wave edges can overlap.
- **RTL pitfalls:**
  - Strips twice the screen width overflow to the left in RTL, so wave strips set `direction: ltr`.
  - Logical insets resolve in an element's own (vertical) writing mode, so the side rails use physical sides.
  - The ring text is centred on its path and fitted with `lengthAdjust="spacingAndGlyphs"`, which keeps Arabic letters joined.
- **Verification (preview):** the seeded Playwright run (mock providers; the test product was deleted afterwards) made 57 visits across dark/light × ar/en × desktop/phone with effects on.
  - No console errors and no horizontal overflow. Lenis ran on every desktop page, and the liquid layer was idle after every page load.
  - A timing probe showed the pour holds until the next page arrives and then drains at once; calm mode navigates instantly.
  - The sticky masthead stayed at top 0 in every frame of a glide. Screenshots taken mid-glide can show it offset; that is a capture artifact.
  - axe flagged only the light-theme rails, whose difference-blended white text it measures as 1.23:1. The rails now use the muted ink there, and a re-check of 16 pages across all four combinations found no violations.

### 2026-09-27 — Ghost batches from photos
- **Why:** the owner asked for the Ghost page to work straight from uploaded photos: 30+ models in one go, handled one by one (front, back and close-ups for all, then colours after approval), with prompts that keep every detail, a clean image and one look on a white background.
- **Data:** `ghost_batches` (model, catalogue style snapshot, options, `colours_requested_at`) and `ghost_batch_items` (phase, lease, meta), both with owner RLS (migration `20260927080548_ghost_batches`). Each model becomes a one-piece product, so the existing DNA, colourway, job and generation pipeline runs unchanged and the models show up under Products. A batch's catalogue jobs carry its id in the existing `catalogue_jobs.batch_id`.
- **Intake** (`lib/ghost-batches/intake.ts`, pure and tested):
  - Grouping: one folder per model first, then file names ("DS1024_front", "DS1024 lace" → DS1024), then camera names (IMG_…) in order, N photos per model.
  - Roles come from English and Arabic keywords (front/أمام, back/خلف, detail/تفاصيل, colour/لون); untagged photos default to front → back → details.
  - Photos upload straight to Storage model by model; each model is handed to the runner as soon as its photos are registered, so work starts while the rest upload. Swatch colours are the median of the swatch's centre.
- **Photo sorting:** a new brain method, `classifyPhotos` (template `classify-photos@1.0.0`, 1024 px images). It re-sorts only the photos tagged by order, labels every photo (better close-up references) and puts the clearest photo of each view first, since that one becomes the reference. If sorting fails, the order tags stand.
- **DNA:** by default a batch approves a DNA draft that passes `dnaCompletenessIssues`; the "review each DNA" option (or an incomplete draft) holds the model in `dna_review`, and it continues on its own once the owner approves the DNA.
- **Runner:** there is no server cron (Vercel Hobby) and no service-role key in Vercel, so the browser drives the work. `GhostBatchRunner` is mounted in the studio layout and calls `POST /api/ghost-batches/advance` (`maxDuration` 300) in a loop while any studio tab is open. Each call does one unit of work, decided by the pure `planNextStep` (`lib/ghost-batches/plan.ts`):
  1. settle finished generations;
  2. run the next queued job in model order;
  3. queue stage one after a DNA approval;
  4. analyse the next model, at most two models ahead;
  5. queue colours;
  6. check fidelity.
  - At most 8 generations per batch sit at the provider at once.
  - Analyses hold a 6-minute lease; after two cut-off attempts the model fails.
  - Jobs still "working" after 6 minutes settle from what they submitted, or fail with a retry.
  - Colours are queued three per job, so writing their prompts fits one function run.
  - Running with the laptop closed needs `SUPABASE_SERVICE_ROLE_KEY` plus a scheduler (e.g. Supabase pg_cron + pg_net calling a secret-protected route). Not built yet.
- **Colours:** "Start colours" sets `colours_requested_at`. From then on, every model with an approved front gets a colour job for each colour that no earlier job covered, including fronts approved and colours added later.
- **Prompts v2** (`lib/prompts/v2/ghost.ts`, `ghost@2.0.0`; v1 removed, it lives in git history):
  - The director brain now sees the same isolated reference photos as the image model.
  - It returns an instruction (edit mode or text mode), a "keep exactly" checklist of 4–8 checkable details for the view, and a "leave out" list of handling artefacts only (hanger, room, creases, lint), never design details.
  - Code appends a fixed HOUSE STYLE block built from the catalogue style (`lib/prompts/house-style.ts`): background, invisible display form, camera, light, framing, shadow, pressed finish and realism. It is identical for every product, which is what keeps the catalogue in "one spirit".
  - Code also appends ghost-only negatives (hanger, room, tinted background, changed length or straps), then the PRODUCT LOCK and STRICT NEGATIVES as before.
- **White catalogue:** the default catalogue style is now pure white `#FFFFFF`, no shadow and high-key light. The migration switches owner settings that still held the untouched seeded style; a customised style is left alone.
- **Image finishing** (`finishCatalogueImage`):
  - Front, back and colourway results are trimmed to the garment (flat edge colour, threshold 12, trim refused if it would keep under 15% of a side) and re-padded to the catalogue margin and aspect ratio, so all products line up. Close-ups are only padded.
  - Padding uses the image's own edge colour, so a near-white background never shows a seam.
  - A background that is not flat or not the catalogue colour is flagged (`params._finish.backgroundOk`) on the tile and in the compare view.
  - Garment pixels are never resampled; transparent cut-outs are flattened onto the catalogue background.
- **Review:** with the fidelity option (default on), the runner checks every finished image against its references once the provider work is done, and the score shows on each tile. "Review N images" walks every finished image in the compare view (approve moves to the next image), and the checker's findings can be turned into the regeneration note in one click.
- **TODO (Higgsfield):** ghost images from photos need a multi-reference image-edit model; Soul's single `image_reference` is not an editor. The docs are still blocked from the sandbox (403), and the SDKs (`@higgsfield/client` 0.2.6, `higgsfield-client` 0.2.0) list no edit endpoint. Once the docs are reachable, register the edit model in `models.ts`; until then the owner can add it as a custom model in Settings.
- **Verification:**
  - Typecheck, lint, format and 149 unit tests pass, including grouping, planning, framing and prompt tests.
  - A local lab page (not committed) rendered the intake and the board in ar/en × dark/light and on a phone, with no console errors and no horizontal overflow.
  - Not yet run end to end on the preview: the Vercel connector now points at another team, and Supabase and Vercel hosts are blocked from this sandbox.


### 2026-09-27 — Higgsfield API docs
- **Source:** docs.higgsfield.ai is still blocked from the sandbox (403), so the owner pasted the pages: Requests and lifecycle, Polling, Webhooks, File uploads, Errors and retries, Rate limits, the API reference (OpenAPI 2.0.0: get request status, cancel a queued request), How the API works, the video model index, and screenshots of the console catalogue. They confirm what the SDK gave:
  - base URL and `Authorization: Key {api_key_id}:{api_key_secret}`;
  - a submit answers `{ status, request_id, status_url, cancel_url }`, and the docs say to use those URLs rather than build them;
  - results in `images[].url` / `video.url`, kept for at least seven days;
  - cancel answers 202, or 400 once processing started;
  - uploads are a presigned PUT with every `upload_headers` entry, then `public_url` goes in the model's input field.
- **Errors** (`higgsfieldError`): FastAPI `{detail}`. 400 invalid input or the concurrency limit, 401 credentials, 403 insufficient credits, 404 model or request not found for the account, 422 validation, 423 model blocked for now, 500 retry with backoff, 503 model disabled or not ready. Failed and nsfw requests are not charged.
  - The concurrency limit is only recognisable by its message ("Maximum number of concurrent requests (N) has been reached"). The docs warn against parsing messages for permanent decisions; here the only decision is to wait, and if the wording changes the request fails like bad input.
  - Every response carries `X-Correlation-ID`: it is stored as `params._correlationId` on submit and appended to errors as `[ref …]` for support.
- **No duplicate submits:** submissions take no idempotency key, so a submit is sent again only after a 500 or a failure before the request left (DNS, refused connection). Never after a timeout, a dropped connection, a 502 or a 504, which Higgsfield may already have accepted.
- **Waiting room** (`lib/generations/waiting.ts`, `lib/generations/service.ts`):
  - `HIGGSFIELD_MAX_CONCURRENT` holds the account's limit (shown in the console; default 4, the docs' example). A request counts as open once it is being sent until it settles.
  - A new request beyond the limit, or one Higgsfield turns away without creating a request (busy 400 or 429, 403, 423, 500, 503), stays `queued` with no request id and a `_waiting` note (`reason`, `since`, `message`) in its params. The stored body is re-signed from its `storage:` markers when it is finally sent.
  - Polls send a waiting row when its rest is over (capacity 5 s, credits 60 s, paused model or server error 30 s) and there is room. The row is claimed through `submitted_at` first, so two polls never send it twice. It fails after six hours of waiting.
  - When the account looks full, the oldest open requests are polled first, so one that finished (or was cut off mid-submit) while nobody had its page open frees its slot.
  - Ghost batches may hold twice the account limit (at least 4), so the next model's prompts are written while earlier images wait. Tiles say why a request waits (`generation.waiting.*`).
  - Tested against an in-memory Supabase stand-in (`tests/stubs/fake-supabase.ts`) and a fake Higgsfield with its own limit, including two polls racing for the same row (mutation-checked).
- **Polling:** the stored `status_url` is used when it points at the API's own origin (the key goes with it); otherwise the path is built. The cadence follows the docs: 2 s at first, ×1.5 per poll, up to 10 s.
- **Webhook:** deliveries are unsigned `{ request_id, status: completed | failed | nsfw, error, payload }`. Higgsfield retries network failures and 5xx for two hours, gives up on 4xx, wants an answer within ten seconds and may deliver twice.
  - The route checks our URL signature, the envelope and the request id, answers at once, and settles in `after()`, still from the status endpoint rather than the payload.
  - It answers 503 while the submit has not stored the request id yet, so Higgsfield delivers again.
- **Cost:** the documented status response has no cost field. `extractCost` stays for an undocumented one; the Billing and retention page has not been read yet.
- **TODO (models):** the model pages are not in yet.
  - The console catalogue (2026-09-27) lists these image models: Marketing Studio Image, Grok Imagine 2.0, Soul 2, Ideogram 4.0, Recraft 4.1, Soul Standard, Qwen Image 3 and Z-Image Turbo, plus the workflows Product shots, Graphic ads and Marketplace design. The video index lists 22 families (Kling, Seedance, Wan, Cinema Studio, MiniMax…).
  - None of the SDK-era built-in endpoints (Soul v1, Flux Kontext, Seedream 4, DoP, Speak) appears there, so they may be retired.
  - Candidate edit models for ghost images: Grok Imagine 2.0 ("precise edits while preserving image details") and Marketing Studio Image (edits from text and image inputs, 1K–4K).
  - Register them from their own docs pages (or `/docs/openapi.json`), and give the ads an image-to-video or reference-to-video model in place of DoP.

### 2026-09-27 — Models from the Higgsfield docs
- **Source:** the owner allowed `docs.higgsfield.ai` in the environment's network settings (Custom access), so the model pages were read directly. The docs list 35 model families and 82 workflows. `/docs/openapi.json` only holds 8 paths and is "supplementary", so each workflow's own page is the source: endpoint, usage notes, the complete JSON input schema and the output field.
- **Snapshot:** `scripts/higgsfield/sync-models.mjs` reads the image and video indexes, every family page and every workflow page into `lib/providers/higgsfield/docs/workflows.json` (kept out of Prettier). `docs-catalog.ts` turns it into model specs when the registry loads. Run the script again to pick up new models, review the diff and deploy. This is the "single config file" the registry rule allows, since the API has no listing endpoint.
- **Registry:** 68 models (15 image, 53 video), each with `source: "docs"` and a `family` for grouping.
  - Left out: 14 workflows that need a source video (Genjutsu, Kling motion control, video edit / extend / reference, Wan 2.6 reference) and Soul ID, which trains a character rather than generating.
  - The SDK-era built-ins (Soul v1 `/v1/text2image/soul`, Flux Kontext, Seedream 4, DoP, Speak) are gone. The docs no longer list them and say not to substitute silently. A job saved with a removed model (or with a mock model, once a key is set) fails with "Model … is not available"; queue it again with a current model.
- **Conversion rules:**
  - References come from `image_urls`, else `image_url`, else `first_frame_url`. A reference is required when the schema says so, when `minItems` ≥ 1, or when the notes say so (Wan 2.7 reference-to-video).
  - The maximum is `maxItems` or a limit stated in the notes (HappyHorse 9, Wan 2.7 5). With neither, the studio sends at most 4 (Kling O3 / Omni image reference) and says so in the source note. Anything above 16 is capped at 16.
  - Modes follow the output kind and whether references are required.
  - Durations come from enums or integer ranges. Resolution tiers are sorted (480p < 720p < 1k < 1080p < 2k < 4k), so "highest" means the top tier.
  - Prompt limits come from `maxLength` or the notes: Kling 3.0, O3 and Omni 2,500; Kling 3.0 Turbo text-to-video 3,072; MiniMax H3 7,000. Negative prompts are trimmed to their `maxLength` (PixVerse 2,048).
  - MiniMax H3 image-to-video drops `aspect_ratio`, because the output follows the keyframe. Grok Imagine Video in reference mode keeps only 480p and 720p.
- **House switches:** every model that has them gets `enhance_prompt`, `prompt_extend`, `enable_thinking` and `prompt_optimizer` set to false, so it receives the exact PRODUCT LOCK the brain wrote. Qwen Image 3 enables both of its rewriting switches by default. Native audio is off (`generate_audio: false`, Kling `sound: "off"`), because ad shots are cut to music in the montage.
  - Left at their defaults: Marketing Studio `quality` (high) and `moderation` (auto), Kling O3 / Omni `mode`, Ideogram `image_weight`. Soul's `image_reference_url` only guides prompt enhancement, so Soul is text-to-image here.
- **Defaults** (`FAMILY_ORDER`; the first model that supports a mode is its default, and Settings defaults still win):
  - **Grok Image 2.0** for ghost images, sheets and preview frames: "generate and edit images with up to ten image references"; the console card says "precise edits while preserving image details".
  - Marketing Studio Image (16 references, 4K) and Qwen Image 3 Edit follow, to compare on real products with the fidelity scores.
  - **Kling 3.0 Pro image-to-video** for ad shots. It takes 3–15 s but no aspect ratio (framing follows the frame), so exact 9:16 still comes from "preview frame first", or from a model with `aspect_ratio` such as Seedance 2.0 reference-to-video.
- **Cost:** the Billing page documents `POST /estimate/{endpoint}` with the submit body, returning `{ credits, usd }`.
  - The estimate runs alongside each submit and never blocks it. `usd` goes to `generations.cost` and both values to `params._estimate`.
  - Failed, nsfw and canceled requests are set to 0, since the docs say they are not charged. The studio's own 45-minute give-up keeps the estimate, because Higgsfield may still finish the request.
- **UI:** pickers group models by family (`ModelSelectItems`), and Settings lists families as collapsible sections with each workflow's capabilities and docs path.
- **Resolved:** the Phase 1 and 2026-09-27 TODOs about model endpoints, parameters and cost. `api.higgsfield.ai` is still not reachable from the sandbox, so no request was sent live. The first real run should be one or two models, with Grok and Marketing Studio compared in the review.

### 2026-09-27 — Director brain through an OpenAI-compatible gateway
- **Why:** the owner pays for VyceAI, an OpenAI-compatible API proxy that serves Claude, GPT, DeepSeek and other models under one key, and asked to run the director brain through it instead of separate Anthropic or Gemini keys.
- **Risk accepted by the owner:** every brain request (garment photos, DNA, prompts) goes to the gateway operator, and availability depends on that provider. The provider's public web app bundle includes admin tooling for creating and pooling accounts on other AI services and for reading recent customer messages. The owner was told and chose to go ahead. The integration is generic (any OpenAI-compatible base URL), so switching providers is an env change.
- **Settings:** migration `20260927120928_llm_gateway` widens `settings.llm_provider` to `claude | gemini | gateway` and adds `gateway_model`. The brain card shows the gateway (named by `LLM_GATEWAY_NAME`) with its key status. Its model field suggests the ids from the gateway's `GET /models`, fetched server-side, cached for 10 minutes and empty on failure.
- **Selection:** the chosen provider comes first, then the next configured one (Claude, Gemini, gateway), then the mock. A gateway needs a model id (Settings or `LLM_GATEWAY_MODEL`); without one it is skipped. The base URL must be https, because the key travels with every request.
- **Requests** (`lib/providers/llm/gateway.ts`): `POST {base}/chat/completions` with `Authorization: Bearer`, a system message, and a user message whose photos are `image_url` parts after their captions (links since the next entry, data URLs as the fallback). No temperature is sent (some models reject it).
- **Adapting to the gateway,** remembered per base URL and model:
  - JSON: `response_format` json_schema (non-strict), else json_object, else the schema in the prompt. Answers are always parsed leniently (fences or prose around the object) and validated with Zod, with the shared repair retry.
  - Output cap: `max_tokens` is capped at `LLM_GATEWAY_MAX_TOKENS` (16,000 by default; the brain's own caps assume thinking models). The cap moves to `max_completion_tokens` when the error names it, and halves (down to 4,096) when the model's limit is lower.
- **Errors:**
  - 401 / 403: key, plan or account verification.
  - 402: balance.
  - 404: unknown model id.
  - 408 / 429: rate limit or daily quota; retried once.
  - 5xx: retried once.
  - A refusal or `content_filter` answer: neutral-wording advice.
  - `finish_reason: "length"`: the answer ran out of space.

### 2026-09-27 — Gateway photos by link, and a vision check
- **Why:** the first real DNA analysis through VyceAI failed with "This model's maximum context length is 270,000 tokens. However, your request resulted in 1,417,769 tokens." The gateway counts inline images (base64 data URLs) as text: the product's 12 photos at 1,568 px came to about 1.4 million tokens, where Claude counts about 1,600 per image.
- **Links:** every brain call site passes an image host (`storageImageHost(supabase, ownerId)`, `lib/storage/brain-links.ts`).
  - The gateway brain copies the images it already resized to `{owner}/tmp/brain/{uuid}/`, sends 15-minute signed URLs, and deletes the copies once the answer is in (and after a failed upload).
  - A function cut off mid-call can leave copies behind.
  - Claude and Gemini keep sending inline data, which their APIs count correctly.
- **Vision check** (`lib/providers/llm/vision-check.ts`): a gateway can take an image and never show it to the model, and the brain would then write garment specs from the captions.
  - Before a model's first photos, it gets a 256 px test image of four squares in random colours out of six, and must name the top-left and bottom-right colours. A blind model guesses both about 3% of the time.
  - Links are tried first, then inline. The first route that passes is remembered for 6 hours per server instance, keyed by base URL, model and whether links are available. Concurrent first calls share one check.
  - A model that fails both routes is refused ("choose a model marked Vision"). Key, balance, quota and outage errors surface as they are.
- **Errors:** a context-length error (400 or 413 with the usual wording) gets its own message and no longer cycles through the JSON modes; neither does an error about an image. If the links failed the check and the inline photos then overflow, the message says why the links failed.
- **Note:** the 270,000-token limit reported for `claude-sonnet-4-6` is not Claude Sonnet 4.6's (1M tokens); VyceAI's site gives 270K for GPT 6 Astra. The vision check proves that the model reads images, not which model answers.

### 2026-09-27 — Inline gateway photos fitted to the reported limit
- **Why:** the first run with links. VyceAI's route for `claude-sonnet-4-6` failed the vision check by link (it named white / blue for blue / green) and passed it inline. So its photos must go inline, where the product's 12 photos still count as about 1.4 million tokens against 270,000.
- **Fitting** (`askInline` in `gateway.ts`, `shrinkLlmImages` in `lib/images/process.ts`):
  - After an overflow with inline photos, the brain reads the model's limit and the counted tokens from the message (`parseOverflow`) and learns how many characters the gateway counts per token.
  - It then re-encodes the photos (JPEG q80) at the largest common long edge, from 1,568 px down to 384 px, that keeps the request within 85% of the limit after the output cap.
  - It retries twice at most. Later calls fit the photos before sending, so only the first call per server instance overflows.
  - When the error names no numbers (a bare 413), the photo budget halves on each retry.
  - When even 384 px does not fit, the error says "Too many photos…" and suggests fewer photos, a model that takes links, or a direct key.
- **Trade-off:** only what the brain sees shrinks; Higgsfield still gets the full-size references.
  - For the owner's 12-photo product, the photos need to shrink to about 15% of their size, which is roughly 700 px instead of 1,568 px.
  - With 1–3 references (ghost prompts, fidelity checks) little or nothing is lost.
  - Fewer photos per product, a gateway model that takes links, or a direct Claude or Gemini key keep full detail.

### 2026-09-27 — Gateway photos through the Anthropic messages format
- **Why:** after the fitting went live, `agnes-3.0-flash` on VyceAI failed the colour test by link and inline (it named red / yellow for green / red). Then `claude-sonnet-4-6`, which had passed it inline once, failed it both ways (yellow / blue for red / white).
  - The earlier pass was most likely a lucky guess (about 1 in 30). Together with the 1.4 million tokens counted for 12 photos, this suggests VyceAI's chat completions route hands images to the model as text.
  - VyceAI's own models page marks only `nemotron-vision` and `minimax-m3` as Vision, and neither is in the owner's plan. The owner asked to keep VyceAI.
- **Anthropic format:** VyceAI also documents `POST /v1/messages` ("Anthropic messages"), where images are real image blocks. The gateway brain now speaks it as well:
  - Headers: `x-api-key` plus Bearer, and `anthropic-version: 2023-06-01`.
  - Body: `system`, `max_tokens`, and image blocks (`url` or `base64`). The JSON schema goes in the prompt, since this format has no `response_format`.
  - Replies: the stop reasons `refusal` and `max_tokens` are handled, and a chat-shaped reply from that endpoint is read too.
- **Routes** (this replaces the two-route check and its 6-hour memory from the entry above):
  - Photos take the first of four routes that passes: chat links, messages links, messages inline, chat inline. The link routes need the Storage host.
  - A route must read two test images in a row, so a lucky pair is about 1 in 900.
  - Routes are tested side by side, because VyceAI takes 12–19 s per answer; a route's second test only follows a first success.
  - On the Anthropic format, a 404 or a refused key only rules out that route.
  - The choice is re-checked every 30 minutes, since a pooled gateway may change what serves a model.
  - When no route works, the error lists every route's result.
- **Not verified live:** there is no VyceAI key in the sandbox, so the next analysis on production is the test. If every route fails, that model on VyceAI cannot see images, and the brain needs a Vision model or a direct key.

### 2026-09-27 — Gemini brain: Google's error text and Flash fallbacks
- **Why:** every route through VyceAI failed the image test for `claude-sonnet-4-6`: it named red / blue for three different images, the same guess each time. So the owner moved the brain to a free Gemini key. The first analysis failed with "Gemini is temporarily unavailable", a 5xx from Google after the SDK's own retries, and the message did not say which error.
- **Errors:** mapped Gemini errors now carry Google's message and the HTTP status (`detail`, `status`). A 404 says the model is not offered to this key.
- **Schema:** a 500 in schema mode is retried once with the schema in the prompt, as a 400 already was. Google's error reference lists 500 as an unexpected server error.
- **Fallback models:** when the chosen model stays unavailable (5xx), the brain asks `gemini-3.7-flash`, then `gemini-3.5-flash`.
  - Both are free-tier Flash models on the pricing page as of 2026-09-27; `gemini-flash-latest` points at 3.8 Flash.
  - A fallback model that no longer exists is skipped. Key, quota and bad-request errors never switch models.
  - If none answers, the error carries what each model said. The DNA row still records the chosen model, and an answer from a fallback is logged.
- **Free tier** (Google's pricing and rate-limit pages, 2026-09-27):
  - Flash models are free of charge, with per-project limits; the daily limit resets at midnight Pacific time.
  - Free-tier content is used to improve Google's products. Enabling billing stops that; 3.8 Flash then costs $0.75 per million input tokens and $3.75 per million output tokens until the end of 2026.

