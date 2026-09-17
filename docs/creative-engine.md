# Creative Engine — the real-media foundation

What exists after Phase 10A, and what the next phase has to build on top of it. Nothing in
this document describes a capability Populr has today: **no media provider is wired up, and
Studio is untouched.** The honest current capability is still Video Script + Shot List.

## The invariant

> A provider response is not an asset. A provider task is not an asset. A provider's
> `video_url` is not an asset.

Only `downloaded → validated → stored → media_assets row` is a Populr asset, and only that
is `ready`. This is enforced in `lib/creative/jobs.ts`: `mapProviderStatus("succeeded")`
returns **`downloading`**, not `ready`, and `isReady()` requires an `assetId`. There is no
path through the state model that reaches `ready` without a stored asset.

## Why storage came first

The BytePlus documentation is explicit: **`video_url` is valid for 24 hours**, and a
Seedance 2.5 URL can be downloaded at most 100 times. A generation that is not transferred
within a day is a dead link that a database row still calls a success. Building the provider
before the place to put its output would have produced exactly the failure Phases 7 and 8
were spent removing, only more expensive, because these ones cost money to create.

## The intended flow

```
POST /api/creative/generate
  → prepareCreative()            reject out-of-range before anything is billed
  → creative_jobs row            UNIQUE(idempotency_key) — the real duplicate guard
  → provider task created        status: submitted, provider_task_id stored
  → return { jobId }             the request ends here; nothing waits

Seedance
  → callback_url
  → /api/webhooks/seedance       authenticate, then look the task up by provider_task_id
  → status: downloading
  → fetch bytes from video_url   inside its 24h window
  → validateBuffer()             real mp4? right size? right duration?
  → storage().upload()           private blob, key from assetKey()
  → validateStored()             prove it can be read back
  → media_assets row             the asset finally exists
  → status: ready, asset_id set
```

**The webhook is primary; the sweeper is the backstop.** A scheduled job asks
`repo.stale(before)` for non-terminal work that has not moved recently, queries the provider
for each, and drives the same transitions. A missed webhook then costs latency instead of a
paid generation.

Two constraints on the sweeper, both from the verified docs: provider task records are
queryable for **7 days only**, so a job older than that can never be recovered and should be
failed rather than retried forever; and the output URL expires in **24 hours**, so the
sweeper's useful window is much shorter than its lookback.

`.github/workflows/publish.yml` already runs every 10 minutes and is the natural host —
`vercel.json` currently holds only daily and weekly crons.

**Never poll from inside a request.** Vercel functions do not outlive their response, and a
2–5 minute wait is not something a lambda can hold. This is also why the existing Job Engine
does not own the provider relationship (see the comment at the top of `lib/creative/jobs.ts`).

## Idempotency

`idempotencyKeyFor(workspaceKey, specHash, nonce)`.

- `specHash` covers the provider-facing spec **and** duration, ratio and resolution, so two
  requests that differ only in length are correctly treated as different generations.
- `nonce` is what makes "Regenerate" work. Double clicks, retried fetches, React
  re-renders and replayed POSTs carry the same nonce and collapse into one job; a deliberate
  regeneration passes a fresh one.

The guard is a `UNIQUE` constraint with `ON CONFLICT DO NOTHING`, not a `Map`. The Job
Engine's `idem` map is per-process, and two lambdas racing on the same key both miss it —
which for free work is a duplicate row and for video generation is a duplicate charge.

## Cost

`estimateCostUsd()` returns **null** when `SEEDANCE_USD_PER_SECOND` is unset, and callers
must show nothing rather than a guess. The published rates are promotional and approximate;
baking one into the source would produce a number that becomes quietly wrong when the
promotion ends, which is worse than no number because it looks like knowledge.

Refusals happen in `prepareCreative()` before any provider call: duration outside the
model's 4–15s range, duration over our own ceiling, unsupported ratio or resolution, an
invalid specification, or more than `maxShots` scenes.

## Security

- The blob store is **private**. Its URLs never leave the server.
- Bytes are served only by `GET /api/creative/assets/[id]`, which checks
  `media_assets.workspace_key` against the caller's workspace and returns `404` for both
  "missing" and "not yours".
- That route refuses any `uri` that is not a key this engine generated
  (`isValidKey`), so it cannot be turned into an open proxy for arbitrary URLs.
- Storage keys contain no caller-supplied text at all — a workspace hash, a job hash and a
  UUID we generate.
- Provider keys stay server-side. There must never be a `NEXT_PUBLIC_` variant.

## Verified provider facts

From `docs.byteplus.com`, pages last updated 24 August 2026.

| | |
|---|---|
| Create | `POST https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks` |
| Retrieve | `GET .../contents/generations/tasks/{id}` |
| Auth | `Authorization: Bearer $ARK_API_KEY` |
| MVP model | `dreamina-seedance-2-0-mini-260615` — 4–15s, 480p/720p, 24fps, MP4 |
| Response | `{"id": "cgt-..."}` |
| Statuses seen | `queued`, `running`, `succeeded`, `failed` (+ a cancel endpoint) |
| Webhook | `callback_url` on the create request |
| URL lifetime | 24 hours |
| Task retention | 7 days |

Unknown statuses map to `running`, never to a terminal state — a provider inventing a new
string must not be able to talk this system into declaring success.

**Not verified:** exact rate limits (no numbers published), and whether the status enum is
complete. Both should be treated as unknown rather than assumed.

## What is deliberately absent

- **References.** v1 is text-to-video only. Populr has no logo, product image or founder
  image storage, so a reference pack today could only be fabricated. `VisualPlan.referenceAssets`
  already exists and stays compatible.
- **Voiceover.** `Scene.voiceover` and `Script.voiceNotes` are in the model already, so TTS
  can arrive later without a rewrite.
- **Image generation.** No real provider exists; the registry supports adding one.
- **Dimensions.** `validate.ts` reports `null` rather than parsing `tkhd`, because a
  confidently wrong number on rotated video is worse than an admitted unknown.
