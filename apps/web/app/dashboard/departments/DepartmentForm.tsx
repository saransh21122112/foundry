"use client";

import { useRef, useState } from "react";
import { updateDepartmentConfig } from "./actions";

/**
 * Wraps the plain form action in a client submit handler so the action's
 * returned { ok, error } result surfaces as an inline message instead of
 * Next.js's generic error boundary. A *thrown* Error's message is sanitized
 * by Next.js in production Server Actions regardless of a client try/catch
 * — the free-plan ceiling in actions.ts must return the error, not throw
 * it, for this to work. Same pattern as PromptsBoard's handleSave.
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
      const result = await updateDepartmentConfig(new FormData(formRef.current));
      setStatus(result.ok ? { kind: "ok", text: "Saved." } : { kind: "error", text: result.error });
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
