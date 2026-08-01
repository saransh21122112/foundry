"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { saveAgentPrompt, generatePromptEdit } from "./actions";
import type { AgentPromptEntry } from "./agents";

export function PromptsBoard({
  agents,
  selectedId,
  initialContent,
}: {
  agents: readonly AgentPromptEntry[];
  selectedId: string;
  initialContent: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [changeRequest, setChangeRequest] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  // Switching agents (page.tsx re-fetches server-side and passes a fresh
  // initialContent) should load the new agent's content, not keep whatever
  // was left in the textarea for the previous one.
  useEffect(() => {
    setContent(initialContent);
    setStatus(null);
    setChangeRequest("");
    setGenError(null);
  }, [selectedId, initialContent]);

  async function handleSave() {
    setSaving(true);
    setStatus(null);
    try {
      await saveAgentPrompt(selectedId, content);
      setStatus({ kind: "ok", text: "Saved." });
    } catch (err) {
      setStatus({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }

  // Drafts a revised file into the textarea below — nothing is written to
  // disk until the human reviews it (editing further if they want) and
  // clicks the real Save button, same as every other AI-touched surface in
  // this product proposing before acting.
  async function handleGenerate() {
    if (!changeRequest.trim() || generating) return;
    setGenerating(true);
    setGenError(null);
    setStatus(null);
    try {
      const proposed = await generatePromptEdit(selectedId, changeRequest);
      setContent(proposed);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }

  const selected = agents.find((a) => a.id === selectedId);

  return (
    <main className="run-layout">
      <div className="run-main">
        <p className="eyebrow">Edit what each agent is told to do</p>
        <h1>Agent prompts</h1>
        <p className="lede">
          Every agent&apos;s system prompt is a plain instructions.md file.
          This edits the one shared template every org currently uses — a
          local dev-only tool, since it only works because apps/web and
          apps/agent-runtime sit on the same disk. No restart needed: the
          next new task picks up your edit automatically.
        </p>

        <div className="panel">
          <p className="eyebrow" style={{ marginBottom: 8 }}>Describe a change — drafts an edit below, doesn&apos;t save it</p>
          <textarea
            value={changeRequest}
            onChange={(e) => setChangeRequest(e.target.value)}
            placeholder='e.g. "Give this agent permission to post updates to a Slack channel" or "Make it always ask before touching anything in production"'
            rows={2}
          />
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 12 }}>
            <button type="button" className="btn" onClick={handleGenerate} disabled={generating || !changeRequest.trim()}>
              {generating ? "Drafting…" : "Draft edit"}
            </button>
            {genError && (
              <span className="mono" style={{ fontSize: 12, color: "var(--ember-hot)" }}>{genError}</span>
            )}
          </div>
        </div>

        <div className="panel">
          <p style={{ marginBottom: 8, fontWeight: 600 }}>{selected?.label ?? selectedId}</p>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={24}
            className="mono"
            style={{ width: "100%" }}
          />
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 12 }}>
            <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            {status && (
              <span className="mono" style={{ fontSize: 12, color: status.kind === "error" ? "var(--ember-hot)" : "var(--iron)" }}>
                {status.text}
              </span>
            )}
          </div>
        </div>
      </div>

      <aside className="task-sidebar">
        <p className="eyebrow" style={{ marginBottom: 8 }}>
          Agents ({agents.length})
        </p>
        <ul className="task-list">
          {agents.map((agent) => (
            <li key={agent.id}>
              <button
                type="button"
                className={`task-list-item${agent.id === selectedId ? " active" : ""}`}
                style={"parent" in agent && agent.parent ? { marginLeft: 16, width: "calc(100% - 16px)" } : undefined}
                onClick={() => {
                  const params = new URLSearchParams(searchParams);
                  params.set("agent", agent.id);
                  router.replace(`/dashboard/prompts?${params.toString()}`);
                }}
              >
                <span className="task-list-title">{agent.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </main>
  );
}
