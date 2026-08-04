"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { AutonomyLevel, Department } from "@foundry/shared-types";
import { AUTONOMY_LABEL, DEPARTMENT_BLURB, EVENT_TYPE_LABEL } from "@/lib/copy";

export type GraphActivityRow = {
  id: string;
  eventType: string;
  toolName: string | null;
  timestampMs: number;
};

export type GraphDeptNode = {
  id: Department;
  autonomyLevel: AutonomyLevel;
  lastEventAtMs: number | null;
  pendingApprovals: number;
  recent: GraphActivityRow[];
};

// "In flight" if the department logged anything in the last 2 minutes — a
// synchronous proxy for "actively running" rather than tracking explicit
// session start/stop, since activity_log rows are written as the guardrails
// pipeline sees each tool call, not on a session boundary.
const ACTIVE_WINDOW_MS = 2 * 60 * 1000;

// One warm/cool accent per department slot, all distinct from --ember-hot
// (reserved below for the blocked/needs-attention ring) so "hot" only ever
// means one thing on this page.
const DEPT_HUES = [24, 46, 168, 200, 280, 320, 140];

function fmtAgo(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

export function GraphView({ nodes, orgLabel }: { nodes: GraphDeptNode[]; orgLabel: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const [selected, setSelected] = useState<Department | null>(null);

  // Re-render just to keep "Xs ago" text current in the side panel — the
  // canvas itself repaints continuously via its own rAF loop below.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const totalPending = nodes.reduce((sum, d) => sum + d.pendingApprovals, 0);
  const dismissedCountRef = useRef(0);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  useEffect(() => {
    if (totalPending > dismissedCountRef.current) setBannerDismissed(false);
  }, [totalPending]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let W = 0;
    let H = 0;
    function resize() {
      const dpr = window.devicePixelRatio || 1;
      W = container!.clientWidth;
      H = container!.clientHeight;
      canvas!.width = W * dpr;
      canvas!.height = H * dpr;
      canvas!.style.width = `${W}px`;
      canvas!.style.height = `${H}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    function positions() {
      const cx = W / 2;
      const cy = H / 2;
      const r = Math.min(W, H) * 0.34;
      return nodesRef.current.map((n, i) => {
        const angle = (i / nodesRef.current.length) * Math.PI * 2 - Math.PI / 2;
        return { n, x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r, hue: DEPT_HUES[i % DEPT_HUES.length] };
      });
    }

    let raf = 0;
    function draw() {
      const cx = W / 2;
      const cy = H / 2;
      const pts = positions();
      const now = Date.now();
      ctx!.clearRect(0, 0, W, H);

      pts.forEach(({ n, x, y, hue }) => {
        const active = n.lastEventAtMs != null && now - n.lastEventAtMs < ACTIVE_WINDOW_MS;
        const blocked = n.pendingApprovals > 0;

        ctx!.beginPath();
        ctx!.moveTo(cx, cy);
        ctx!.lineTo(x, y);
        ctx!.strokeStyle = blocked
          ? "rgba(229,72,77,0.55)"
          : active
            ? `hsl(${hue} 75% 60% / 0.55)`
            : "rgba(237,234,227,0.08)";
        ctx!.lineWidth = active || blocked ? 1.8 : 1;
        ctx!.stroke();

        if (active) {
          const speedMs = 1400;
          for (let i = 0; i < 3; i++) {
            const t = (now / speedMs + i / 3) % 1;
            const px = cx + (x - cx) * t;
            const py = cy + (y - cy) * t;
            ctx!.beginPath();
            ctx!.arc(px, py, 2.4, 0, Math.PI * 2);
            ctx!.fillStyle = `hsl(${hue} 90% 72%)`;
            ctx!.shadowColor = `hsl(${hue} 90% 62%)`;
            ctx!.shadowBlur = 9;
            ctx!.fill();
          }
          ctx!.shadowBlur = 0;
        }
      });

      // hub
      ctx!.beginPath();
      ctx!.arc(cx, cy, 22, 0, Math.PI * 2);
      const g = ctx!.createRadialGradient(cx, cy, 0, cx, cy, 22);
      g.addColorStop(0, "#ffd9b0");
      g.addColorStop(0.55, "#f2843d");
      g.addColorStop(1, "#a8571f");
      ctx!.fillStyle = g;
      ctx!.shadowColor = "rgba(242,132,61,0.5)";
      ctx!.shadowBlur = 16;
      ctx!.fill();
      ctx!.shadowBlur = 0;
      ctx!.font = "600 10px ui-monospace, monospace";
      ctx!.fillStyle = "#16151a";
      ctx!.textAlign = "center";
      ctx!.textBaseline = "middle";
      ctx!.fillText("ORG", cx, cy);

      pts.forEach(({ n, x, y, hue }) => {
        const active = n.lastEventAtMs != null && now - n.lastEventAtMs < ACTIVE_WINDOW_MS;
        const blocked = n.pendingApprovals > 0;
        const r = 13;

        if (blocked) {
          const breathe = 0.35 + 0.3 * Math.sin(now / 420);
          ctx!.beginPath();
          ctx!.arc(x, y, r + 8, 0, Math.PI * 2);
          ctx!.strokeStyle = `rgba(229,72,77,${breathe})`;
          ctx!.lineWidth = 2;
          ctx!.stroke();
        } else if (active) {
          const breathe = 0.3 + 0.25 * Math.sin(now / 480);
          ctx!.beginPath();
          ctx!.arc(x, y, r + 7, 0, Math.PI * 2);
          ctx!.strokeStyle = `hsl(${hue} 85% 65% / ${breathe})`;
          ctx!.lineWidth = 1.5;
          ctx!.stroke();
        }

        ctx!.beginPath();
        ctx!.arc(x, y, r, 0, Math.PI * 2);
        ctx!.fillStyle = `hsl(${hue} 60% 55% / 0.9)`;
        ctx!.fill();
        ctx!.lineWidth = selected === n.id ? 2 : 1.2;
        ctx!.strokeStyle = selected === n.id ? "#edeae3" : `hsl(${hue} 80% 75%)`;
        ctx!.stroke();

        ctx!.font = "11px ui-monospace, monospace";
        const label = n.id;
        const tw = ctx!.measureText(label).width;
        const ly = y + r + 15;
        ctx!.fillStyle = "rgba(22,21,26,0.75)";
        ctx!.fillRect(x - tw / 2 - 4, ly - 9, tw + 8, 14);
        ctx!.fillStyle = "rgba(237,234,227,0.92)";
        ctx!.textAlign = "center";
        ctx!.textBaseline = "alphabetic";
        ctx!.fillText(label, x, ly);
      });

      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);

    function handleClick(ev: MouseEvent) {
      const rect = canvas!.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const hit = positions().find((p) => (p.x - x) ** 2 + (p.y - y) ** 2 <= 18 * 18);
      setSelected((cur) => (hit ? (cur === hit.n.id ? null : hit.n.id) : null));
    }
    canvas.addEventListener("click", handleClick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("click", handleClick);
    };
    // Re-running on `selected` change is what makes the pinned-node ring
    // repaint immediately on click rather than waiting for the next tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const selectedNode = nodes.find((n) => n.id === selected) ?? null;
  const blockedDepts = nodes.filter((n) => n.pendingApprovals > 0);

  return (
    <div>
      {blockedDepts.length > 0 && !bannerDismissed && (
        <div className="panel" style={{ borderColor: "var(--ember-hot)", marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div>
              <p className="eyebrow" style={{ color: "var(--ember-hot)", margin: "0 0 4px" }}>
                Needs attention
              </p>
              <p style={{ margin: 0 }}>
                {blockedDepts.map((d) => `${d.id} (${d.pendingApprovals})`).join(", ")} waiting in the{" "}
                <Link href="/dashboard/approvals">approval queue</Link>.
              </p>
            </div>
            <button
              type="button"
              className="btn"
              onClick={() => {
                dismissedCountRef.current = totalPending;
                setBannerDismissed(true);
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: selectedNode ? "1fr 320px" : "1fr", gap: 16 }}>
        <div
          ref={containerRef}
          className="panel"
          style={{ height: 480, padding: 0, position: "relative", overflow: "hidden" }}
        >
          <canvas ref={canvasRef} style={{ display: "block", cursor: "pointer" }} />
          <p
            className="mono"
            style={{ position: "absolute", bottom: 10, left: 14, fontSize: 11, color: "var(--iron)", margin: 0 }}
          >
            {orgLabel} — click a department for its recent activity
          </p>
        </div>

        {selectedNode && (
          <div className="panel">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <h2 className="mono" style={{ fontSize: 14, textTransform: "uppercase", margin: "0 0 4px" }}>
                {selectedNode.id}
              </h2>
              <button type="button" className="btn" onClick={() => setSelected(null)}>
                ×
              </button>
            </div>
            <p style={{ color: "var(--iron)", fontSize: 13 }}>{DEPARTMENT_BLURB[selectedNode.id]}</p>
            <p className="mono" style={{ fontSize: 12, color: "var(--iron)" }}>
              Autonomy: {AUTONOMY_LABEL[selectedNode.autonomyLevel]}
            </p>
            {selectedNode.lastEventAtMs != null && Date.now() - selectedNode.lastEventAtMs < ACTIVE_WINDOW_MS && (
              <p className="mono" style={{ fontSize: 12, color: "var(--ember)" }}>
                In flight — last activity {fmtAgo(selectedNode.lastEventAtMs)}
              </p>
            )}
            {selectedNode.pendingApprovals > 0 && (
              <p className="mono" style={{ fontSize: 12, color: "var(--ember-hot)" }}>
                {selectedNode.pendingApprovals} waiting on you — <Link href="/dashboard/approvals">review</Link>
              </p>
            )}
            <p className="eyebrow" style={{ marginTop: 12 }}>
              Recent activity
            </p>
            {selectedNode.recent.length === 0 && <p className="panel-empty">No activity yet.</p>}
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {selectedNode.recent.map((row) => (
                <li key={row.id} style={{ borderTop: "1px solid var(--line)", padding: "6px 0", fontSize: 12.5 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>{EVENT_TYPE_LABEL[row.eventType] ?? row.eventType}</span>
                    <span className="mono" style={{ color: "var(--iron)" }}>
                      {fmtAgo(row.timestampMs)}
                    </span>
                  </div>
                  {row.toolName && (
                    <span className="mono" style={{ color: "var(--iron)" }}>
                      {row.toolName}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
