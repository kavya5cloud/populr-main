# Real generation progress — what it would take

Studio shows a single working state while a piece is composed. It does **not** show
"Understanding your business… Planning… Creating…", and that is deliberate: those phases are
real, but nothing currently reports which one is running, so animating them on a timer would
be theatre. A progress bar that is not measuring anything is the same class of lie as a
metric that was never measured.

This note records what would have to change to make those stages true.

## What actually happens today

`POST /api/content/compose` is a single request. Inside `composeWithAi` it runs, in order:

| Phase | Where | Typical cost |
|---|---|---|
| Assemble context | `assembleGenerationContext` — brand voice, market brief, connected platforms and their limits, prior angles | 5 parallel reads, ~200–800ms |
| Build the prompt | `buildPrompt` | negligible |
| Generate | `generateText` → provider chain | 3–20s, the bulk of it |
| Grade | `scoreDraft`, language-aware | <5ms |
| Rewrite, if needed | second `generateText` | 3–20s again, fires most of the time |
| Size variants | per-platform trim | negligible |
| Record the angle | `recordComposedAngle` | fire-and-forget |

So there are two long steps, not five, and the second one only sometimes happens. Any
faithful progress display has to say that rather than smoothing it into an even sequence.

## What would need to change

**1. The route has to stream.** `/api/content/compose` returns one JSON body. Progress needs
an event stream. `lib/services/llm-stream.ts` and `app/app/_lib/stream.ts` already do SSE for
token streaming, so the transport exists and the pattern is established — the compose route
would move from `NextResponse.json` to a `ReadableStream` emitting `data:` frames.

**2. `composeWithAi` needs an optional reporter.** Something like:

```ts
type Phase = "context" | "writing" | "grading" | "rewriting" | "sizing";
composeWithAi(input, { onPhase?: (p: Phase) => void })
```

Optional, so every existing caller — the compose route today, and `lib/automation/sources.ts`
on the cron — is unchanged. The cron has nobody watching and would pass nothing.

**3. The rewrite has to be honest.** It fires whenever `scoreDraft` finds enough wrong, which
is most of the time but not always. The UI cannot promise five steps and then skip one. Two
options, and the second is better:

- emit `rewriting` only when it actually starts, and let the list grow
- show the phases as a log that appends, not a progress bar that fills

A bar implies a known denominator. There isn't one.

**4. Cancellation should stay wired.** The route already passes `req.signal` through, so a
client that disconnects stops the work. Streaming must not lose that.

## What not to do

**Do not time the stages.** The temptation is `setTimeout` between labels to make it feel
considered. That is inventing a measurement, which this codebase does not do anywhere else.

**Do not report a phase the caller cannot observe.** "Applying your brand voice" is not a
phase — brand voice is part of the context assembly and the prompt, not a step. If a label
does not correspond to a real `onPhase` call, it should not be on the screen.

**Do not add progress to the cron path.** Nothing is watching, and it would be work done for
no reader.

## Rough size

The reporter and the streaming route are perhaps a day, most of it in getting the client's
partial-frame handling right — `app/app/_lib/stream.ts` already solved that once and the
buffering logic there is worth copying rather than rewriting.

The honest version is a five-line phase log that appends as real events arrive. That is
smaller than what a designer would draw and it has the advantage of being true.
