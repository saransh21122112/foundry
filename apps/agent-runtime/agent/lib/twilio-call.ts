// Plain REST calls against Twilio's documented API
// (https://www.twilio.com/docs/voice/api) rather than the `twilio` npm SDK —
// place_call.ts/get_call_result.ts only need 4 endpoints (create call, fetch
// call, list recordings, fetch transcription text), and a few fetch() calls
// with Basic Auth is a smaller, more auditable surface than a full SDK
// dependency for that — same "plain fetch over adding a client library"
// call as list_public_github_repos.ts made for GitHub's public API.
//
// Platform-level credentials (TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER),
// not per-org — same pattern as RESEND_API_KEY/STRIPE_SECRET_KEY. Foundry
// owns the Twilio account and its cost, not the customer.

const API_BASE = "https://api.twilio.com/2010-04-01";

// A call in one of these Twilio-defined statuses will never produce a
// recording — no point polling further once one of these is reached.
const TERMINAL_CALL_STATUSES = new Set(["completed", "busy", "no-answer", "canceled", "failed"]);

function authHeader(): string {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    throw new Error("TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN are not configured — ask an admin to set them up.");
  }
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
}

function accountSid(): string {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  if (!sid) throw new Error("TWILIO_ACCOUNT_SID is not configured.");
  return sid;
}

async function twilioFetch(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}/Accounts/${accountSid()}${path}`, {
    ...init,
    headers: { ...init?.headers, Authorization: authHeader() },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Twilio API request failed: ${res.status} ${res.statusText} — ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

export type CallOutcome =
  | { status: "in_progress"; callSid: string }
  | { status: "no_answer" | "busy" | "canceled" | "failed"; callSid: string }
  | { status: "completed_no_recording"; callSid: string }
  | { status: "completed"; callSid: string; transcriptText: string | null; recordingUrl: string };

/** Places the call: speaks `message`, then records+transcribes whatever comes next. */
export async function createCall(toNumber: string, message: string): Promise<string> {
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  if (!fromNumber) throw new Error("TWILIO_FROM_NUMBER is not configured — ask an admin to set it up.");

  const escaped = message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${escaped}</Say><Record transcribe="true" maxLength="120" timeout="10"/></Response>`;

  const body = new URLSearchParams({ To: toNumber, From: fromNumber, Twiml: twiml });
  const call = await twilioFetch("/Calls.json", { method: "POST", body });
  return call.sid as string;
}

/**
 * Polls Twilio's REST API (bounded, 2s interval) until the call reaches a
 * terminal status, then — if it completed — waits for the recording's
 * transcription to finish. Returns `{status: "in_progress", callSid}` if
 * `deadlineMs` is hit first, rather than blocking indefinitely; the caller
 * (get_call_result.ts) can be invoked again later with the same callSid to
 * keep waiting, same "check back later" shape as an approval request.
 */
export async function pollCallResult(callSid: string, deadlineMs: number): Promise<CallOutcome> {
  const deadline = Date.now() + deadlineMs;

  let callStatus = "queued";
  while (Date.now() < deadline) {
    const call = await twilioFetch(`/Calls/${callSid}.json`);
    callStatus = call.status as string;
    if (TERMINAL_CALL_STATUSES.has(callStatus)) break;
    await new Promise((r) => setTimeout(r, 2000));
  }

  if (!TERMINAL_CALL_STATUSES.has(callStatus)) return { status: "in_progress", callSid };
  if (callStatus !== "completed") {
    return { status: callStatus as "no_answer" | "busy" | "canceled" | "failed", callSid };
  }

  const recordings = await twilioFetch(`/Calls/${callSid}/Recordings.json`);
  const recordingList = (recordings.recordings as Array<{ sid: string }>) ?? [];
  const recording = recordingList[0];
  if (!recording) return { status: "completed_no_recording", callSid };

  const recordingUrl = `${API_BASE}/Accounts/${accountSid()}/Recordings/${recording.sid}.mp3`;

  while (Date.now() < deadline) {
    const transcriptions = await twilioFetch(`/Recordings/${recording.sid}/Transcriptions.json`);
    const list = (transcriptions.transcriptions as Array<{ sid: string; status: string }>) ?? [];
    const transcription = list[0];
    if (transcription?.status === "completed") {
      const full = await twilioFetch(`/Transcriptions/${transcription.sid}.json`);
      return { status: "completed", callSid, transcriptText: (full.transcription_text as string) ?? null, recordingUrl };
    }
    if (transcription?.status === "failed") {
      return { status: "completed", callSid, transcriptText: null, recordingUrl };
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  // Call finished but transcription is still processing — report what we
  // have (the recording) rather than blocking further.
  return { status: "completed", callSid, transcriptText: null, recordingUrl };
}
