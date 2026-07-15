# Demo video pipeline (local only)

Produces prospect-facing product videos from the local dev environment: synthetic
seed data → Playwright screen recordings → OpenAI TTS narration → ffmpeg assembly
with browser-rendered captions (homebrew ffmpeg has no drawtext/libass — all text
is Playwright-rendered PNGs composited via the overlay filter).

Built 2026-07-14. Outputs live in iCloud `Lanyard Health/` (demo video + sales-kit).

## Prereqs

- Local dev running: `docker compose up -d`, backend on :3002, frontend on :5190
- `brew install ffmpeg`
- `OPENAI_API_KEY` (TTS) — read it from `packages/backend/.env`, never hardcode

## Steps

```bash
# 1. Seed the camera-ready practice (idempotent; refuses prod/non-localhost DB)
cd packages/backend && npx tsx src/scripts/seed-demo-video.ts

# 2. Generate narration audio for a video spec
export OPENAI_API_KEY=$(grep '^OPENAI_API_KEY=' packages/backend/.env | cut -d= -f2-)
node scripts/demo-video/tts.mjs scripts/demo-video/narration/<spec>.json <assets>/audio-<name>

# 3. Record takes (scene numbers: 1-6 = original demo, 7-9 = sales-kit clips)
TAKES_DIR=<assets>/takes node scripts/demo-video/record.mjs 7 8 9

# 4. Build (concat + captions + closing card)
python3 scripts/demo-video/build-video.py scripts/demo-video/narration/<spec>.json <assets> <outdir>
```

`<assets>` is any working directory holding `takes/`, `audio-<name>/`, `work-<name>/`.
A copy of the 2026-07 takes + audio is archived in iCloud `sales-kit/pipeline-archive/`.

## Gotchas learned the hard way

- Take length should land within [narration, narration+3s]: shorter freezes the
  last frame (tpad), longer gets auto-sped-up (setpts). Check mp3 durations first.
- "Approve" buttons need `exact: true` (the "Approved" tab matches /approve/i);
  modal clicks must be scoped to `form` (kanban cards behind the modal match).
- Whitfield's provider id changes every seed run — record.mjs resolves it by NPI
  via docker psql.
- The dev-admin account has no practice link, so practice-scoped dashboard widgets
  render empty locally; scene 9 hides those placeholder cards on camera.
- Guardrails: synthetic data only, never record prod, nothing implying payer
  auto-submission is production-ready, Kay reviews every cut before it ships.
