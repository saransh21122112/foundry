"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

/**
 * A real, live shell — genuine node-pty on the other end (see
 * runtime-core/server.ts), not a request/response log. Separate from the
 * task transcript above: that view replays an eve session's recorded
 * events after the fact; this is a live, two-way terminal a human can type
 * into directly, same as opening Terminal.app against this deployment's
 * own host. Scoped to ops-manager only for now — see the plan/server.ts's
 * own comments on why the other 12 departments aren't wired to this.
 *
 * One PTY per mount: connecting fetches a fresh session id + short-lived
 * token (GET /api/terminal-token), then opens the WebSocket directly
 * against runtime-core on the same ALB this app is already served from —
 * no proxy hop needed for the byte stream itself, just for minting the
 * token (see that route's own comment on why a raw WS proxy wasn't built).
 * Unmounting closes the socket, which kills the PTY server-side — no
 * reconnect-to-a-still-running-shell in this pass, a real limitation
 * named in the plan, not an oversight.
 */
export function LiveTerminal() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"connecting" | "open" | "closed" | "error">("connecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;
    let term: Terminal | null = null;
    let resizeObserver: ResizeObserver | null = null;

    async function connect() {
      if (!containerRef.current) return;

      term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        theme: { background: "#0b0d0f" },
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);
      fitAddon.fit();

      let res: Response;
      try {
        res = await fetch("/api/terminal-token");
      } catch {
        if (!cancelled) {
          setStatus("error");
          setErrorMessage("Couldn't reach the server to start a terminal session.");
        }
        return;
      }
      if (cancelled) return;
      if (!res.ok) {
        setStatus("error");
        setErrorMessage(res.status === 401 ? "Select or create an organization first." : "Couldn't start a terminal session.");
        return;
      }
      const { sessionId, token } = (await res.json()) as { sessionId: string; token: string };
      if (cancelled) return;

      const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(
        `${wsProtocol}//${window.location.host}/runtime-core/v1/session/${sessionId}/terminal?token=${encodeURIComponent(token)}`,
      );

      ws.onopen = () => {
        if (cancelled) return;
        setStatus("open");
        fitAddon.fit();
        ws?.send(JSON.stringify({ type: "resize", cols: term!.cols, rows: term!.rows }));
      };
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data as string) as { type: string; data?: string };
        if (msg.type === "data" && msg.data) term?.write(msg.data);
      };
      ws.onclose = () => {
        if (!cancelled) setStatus("closed");
      };
      ws.onerror = () => {
        if (!cancelled) {
          setStatus("error");
          setErrorMessage("Terminal connection failed.");
        }
      };

      term.onData((data) => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input", data }));
      });

      resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "resize", cols: term!.cols, rows: term!.rows }));
      });
      resizeObserver.observe(containerRef.current);
    }

    connect();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      ws?.close();
      term?.dispose();
    };
  }, []);

  return (
    <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 12px",
          borderBottom: "1px solid var(--line, #26292e)",
        }}
      >
        <span className="mono" style={{ fontSize: 12, color: "var(--iron)" }}>
          Live terminal — ops-manager
        </span>
        <span className="mono" style={{ fontSize: 12, color: "var(--iron)" }}>
          {status === "connecting" && "connecting…"}
          {status === "open" && "● connected"}
          {status === "closed" && "disconnected"}
          {status === "error" && (errorMessage ?? "error")}
        </span>
      </div>
      <div ref={containerRef} style={{ height: 360, padding: 8 }} />
    </div>
  );
}
