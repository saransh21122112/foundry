"use client";

import { useRef, useState } from "react";
import { updateDepartmentConfig } from "./actions";

/**
 * Wraps the plain form action in a client submit handler so a thrown
 * error (e.g. the free-plan department/autonomy ceiling in actions.ts)
 * surfaces as an inline message instead of Next.js's generic error
 * boundary. Same pattern as PromptsBoard's handleSave.
 */
export function DepartmentForm({ children }: { children: React.ReactNode }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!formRef.current) return;
    setSaving(true);
    setStatus(null);
    try {
      await updateDepartmentConfig(new FormData(formRef.current));
      setStatus({ kind: "ok", text: "Saved." });
    } catch (err) {
      setStatus({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit}>
      {children}
      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        {status && (
          <span className="mono" style={{ fontSize: 12, color: status.kind === "error" ? "var(--ember-hot)" : "var(--iron)" }}>
            {status.text}
          </span>
        )}
      </div>
    </form>
  );
}
