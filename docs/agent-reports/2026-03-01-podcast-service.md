# Agent Report: Podcast Service Integration
**Datum:** 2026-03-01
**Zadani:** "Chci integrovat sluzbu API na tvoreni podcastu z news" — Integrate a podcast API service for creating podcasts from news.

## Schvaleny plan
Integrate a PodcastService into the existing RadioWar pipeline that generates 5-10 minute conversational podcast episodes from synthesized war news using Claude CLI for script generation and edge-tts for audio synthesis. Podcasts are generated every production cycle (4 hours) and inserted into the YouTube stream audio buffer.

## Zmenene soubory

| Soubor | Zmena | Proc |
|--------|-------|------|
| `engine/src/config.ts` | Upraven | Added PODCAST_ENABLED, PODCAST_VOICE, PODCAST_INTERVAL_MS, PODCAST_TARGET_MINUTES env vars |
| `engine/src/podcast/prompt-builder.ts` | Novy | Claude prompt builder for podcast script generation + JSON response parser |
| `engine/src/services/podcast-service.ts` | Novy | Core PodcastService class — orchestrates script generation via Claude CLI and audio via TtsService |
| `engine/src/routes/podcast.ts` | Novy | Fastify API routes: POST /generate, GET /latest, GET /episodes, GET /status |
| `engine/src/server.ts` | Upraven | Registered podcast routes |
| `engine/src/services/pipeline.ts` | Upraven | Added Phase 2.5 podcast generation, 'podcast' AudioBufferEntry type, podcast counters, archive support |

## Quality Gate
- [x] Correctness — Implementation matches approved requirements
- [x] Edge cases — Empty stories guard, retry logic, async error handling, concurrent generation lock
- [x] Architecture — Follows existing patterns (service class, prompt builder, Fastify routes, withRetry)
- [x] No pitfalls — No security issues, proper error propagation, no race conditions
- [x] TypeScript compiles — `tsc --noEmit` passes with zero errors

## Iterace
No iterations needed — implementation was clean on first pass.

## Poznamky
- TTS backend is edge-tts (free, already in project). The PodcastService accepts a TtsService instance, so swapping to OpenAI TTS or ElevenLabs later only requires a new TtsService implementation.
- Podcast is generated as Phase 2.5 in the pipeline (after news synthesis, before lyrics), so the same synthesized stories feed both the podcast and the songs.
- Podcasts are inserted at the front of the audio buffer (`unshift`) so they play first in each cycle.
- The manual trigger route (`POST /api/v1/podcast/generate`) runs independently with its own RSS fetch + synthesis, allowing on-demand podcast generation outside the pipeline cycle.
