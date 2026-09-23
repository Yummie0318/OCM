// src/app/api/extract-corners/route.ts
//
// Sends an uploaded survey-table image to a vision model via OpenRouter
// and returns structured { station, northing, easting } rows.
//
// Setup:
//   1. No extra npm install needed — this uses plain fetch.
//   2. Get/rotate your key at https://openrouter.ai/settings/keys
//   3. Add to .env.local (create the file if it doesn't exist):
//        OPENROUTER_API_KEY=sk-or-v1-your-key-here
//   4. Restart your dev server after adding the env var.
//
// IMPORTANT: never put the actual key value in this file or any file you
// commit to git. It only ever lives in .env.local (which must be listed
// in your .gitignore).

import { NextResponse } from "next/server";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// You can swap/reorder this list with any vision-capable models listed at
// https://openrouter.ai/models (filter by "Input modalities: image").
//
// We deliberately do NOT use OpenRouter's "openrouter/free" random router
// here — it can hand the request to models unsuited for this task (reasoning
// models that burn their whole budget "thinking" with no room left to
// answer, or even safety-classifier models that were never meant to follow
// instructions at all).
//
// IMPORTANT: free-tier model ids on OpenRouter routinely get retired, lose
// all providers, or hit shared-pool rate limits (429s) with no warning.
// Instead of pinning one id, we try a short list of models in order, with a
// couple of retries on 429 for each one (since free-pool rate limits are
// often only momentary), before falling through to the next candidate.
//
// Verified live on OpenRouter as of Sep 2026 — re-check
// https://openrouter.ai/models periodically since this list will rot too.
const MODEL_CANDIDATES = [
  "inclusionai/ling-3.0-flash-vl:free", // free — primary
  "qwen/qwen2.5-vl-72b-instruct",       // paid, ~$0.10/M input tokens
  "google/gemini-2.5-flash",            // paid, cheap, large provider capacity — rarely rate-limited
];
// Paid alternative (best accuracy, small cost per image, won't disappear):
// const MODEL_CANDIDATES = ["anthropic/claude-sonnet-4.6"];

const EXTRACTION_PROMPT = `This image contains a table of cadastral/land survey corner coordinates
(a lot data sheet or traverse table). It may be an ASCII box-drawing table or a
spreadsheet-style table, and may include tie lines or reference points (e.g. "TP",
"BLLM", tie point rows) mixed in with the actual lot corners.

Extract ONLY the numbered lot corner points (the points that form the boundary of the
lot — usually numbered 1, 2, 3, 4... and sometimes repeating back to 1 to close the
shape). Skip tie points / reference points / BLLM monuments — those are not lot corners.

For each corner, read its station/corner number, Northing value, and Easting value
exactly as shown (do not round or alter the numbers).

Respond with NOTHING except a raw JSON array — no explanation, no preamble, no
markdown code fences, no commentary before or after. Your entire response must be
parseable by JSON.parse() as-is. Use this exact shape:
[{"station":"1","northing":"18725.955","easting":"23429.970"}, ...]

If the same corner number appears twice (once at the start and once at the end, to
close the traverse), include it only once.`;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Tries each model in MODEL_CANDIDATES in order, returning the first
// successful response.
//
// For each model: on a 429 (rate limit), retries a couple of times with a
// short backoff before giving up on that model — OpenRouter's free-tier
// shared pools are frequently only momentarily saturated, so an immediate
// retry often succeeds. Any other error (404 "model doesn't exist", 5xx,
// network failure) moves straight to the next candidate with no retry,
// since retrying won't help those.
async function callOpenRouter(imageBase64: string, mediaType: string): Promise<Response> {
  const MAX_ATTEMPTS_PER_MODEL = 3; // only 429s actually use more than 1 attempt
  let lastError: { model: string; status: number; text: string } | null = null;

  for (const model of MODEL_CANDIDATES) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_MODEL; attempt++) {
      let res: Response;
      try {
        res = await fetch(OPENROUTER_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            // Optional but recommended by OpenRouter for their rankings/dashboard:
            "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
            "X-Title": "Cadastral Lot App",
          },
          body: JSON.stringify({
            model,
            max_tokens: 4000,
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: EXTRACTION_PROMPT },
                  {
                    type: "image_url",
                    image_url: { url: `data:${mediaType};base64,${imageBase64}` },
                  },
                ],
              },
            ],
          }),
        });
      } catch (networkErr) {
        // Network-level failure (DNS, timeout, etc.) — no point retrying
        // this model, move on to the next candidate.
        console.error(`OpenRouter network error on ${model}:`, networkErr);
        lastError = {
          model,
          status: 0,
          text: networkErr instanceof Error ? networkErr.message : String(networkErr),
        };
        break;
      }

      if (res.ok) return res;

      const errText = await res.text();
      console.error(`OpenRouter error on ${model} (attempt ${attempt}/${MAX_ATTEMPTS_PER_MODEL}):`, res.status, errText);
      lastError = { model, status: res.status, text: errText };

      if (res.status === 429 && attempt < MAX_ATTEMPTS_PER_MODEL) {
        // Respect a Retry-After header if the provider sent one, else use a
        // short exponential-ish backoff (0.8s, 1.6s).
        const retryAfterHeader = res.headers.get("retry-after");
        const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : null;
        const backoffMs = retryAfterMs && !Number.isNaN(retryAfterMs) ? retryAfterMs : attempt * 800;
        await sleep(backoffMs);
        continue; // retry the same model
      }

      // Non-429 error, or out of retries for this model — move to next candidate.
      break;
    }
  }

  throw new Error(
    `All model candidates failed. Last error (${lastError?.model}): ${lastError?.status} ${lastError?.text}`
  );
}

export async function POST(req: Request) {
  try {
    const { imageBase64, mediaType } = await req.json();

    if (!imageBase64 || !mediaType) {
      return NextResponse.json({ error: "Missing imageBase64 or mediaType" }, { status: 400 });
    }

    let openRouterRes: Response;
    try {
      openRouterRes = await callOpenRouter(imageBase64, mediaType);
    } catch (err) {
      console.error("extract-corners: all OpenRouter models failed:", err);
      return NextResponse.json(
        { error: "The AI service failed to process the image (all model options unavailable — please try again in a moment)." },
        { status: 502 }
      );
    }

    const data = await openRouterRes.json();
    const message = data.choices?.[0]?.message ?? {};
    // Prefer the normal answer field; if it's empty (some reasoning models
    // leave content null and only wrote into `reasoning`), fall back to that.
    const rawContent: string = message.content || message.reasoning || "";

    // The model sometimes adds a sentence of preamble before the JSON despite
    // instructions not to, and/or wraps it in ```json fences. Pull out just the
    // [...] array rather than assuming the whole response is clean JSON.
    const stripped = rawContent
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();
    const arrayMatch = stripped.match(/\[[\s\S]*\]/);
    const raw = arrayMatch ? arrayMatch[0] : stripped;

    let corners: Array<{ station: string; northing: string; easting: string }>;
    try {
      corners = JSON.parse(raw);
    } catch {
      const finishReason = data.choices?.[0]?.finish_reason;
      console.error("Could not parse model output as JSON. Full response:", JSON.stringify(data));
      const hint =
        finishReason === "length"
          ? "The model ran out of room before finishing its answer. Try again — it usually succeeds on a retry."
          : "Could not read a table from that image. Try a clearer photo/crop.";
      return NextResponse.json({ error: hint }, { status: 422 });
    }

    if (!Array.isArray(corners) || corners.length === 0) {
      return NextResponse.json({ error: "No corner rows found in that image." }, { status: 422 });
    }

    return NextResponse.json({ corners });
  } catch (err) {
    console.error("extract-corners error:", err);
    return NextResponse.json({ error: "Failed to read the image. Please try again." }, { status: 500 });
  }
}