"use client";

import { useState } from "react";

export default function LoginPage() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (res.ok) {
        const next = new URLSearchParams(window.location.search).get("next") || "/";
        window.location.href = next.startsWith("/") ? next : "/";
        return;
      }
      const data = await res.json().catch(() => ({}));
      setErr(data.error || "Login failed");
    } catch {
      setErr("Couldn't reach the server.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "calc(100vh - 120px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        className="card slide-up"
        style={{ width: 340, maxWidth: "100%", padding: 28 }}
      >
        <h1 style={{ fontSize: 22, marginTop: 0, marginBottom: 6 }}>
          📡 Research Radar
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 0 }}>
          Enter the team password to continue.
        </p>
        <form
          onSubmit={submit}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            marginTop: 16,
          }}
        >
          <input
            className="input"
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="Password"
            autoFocus
            style={{ width: "100%" }}
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || !pw}
            style={{ width: "100%" }}
          >
            {loading ? (
              <>
                <span className="spinner" style={{ marginRight: 8 }} />
                Signing in…
              </>
            ) : (
              "Sign in"
            )}
          </button>
          {err && (
            <div style={{ color: "var(--danger)", fontSize: 14 }}>{err}</div>
          )}
        </form>
      </div>
    </main>
  );
}
