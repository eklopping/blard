import { useState } from "react";
import type { AuthResponse } from "@skilling-mmo/shared";

export function AuthPanel({
  apiBase,
  onAuth,
}: {
  apiBase: string;
  onAuth: (res: AuthResponse) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(mode: "login" | "register") {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, string> = { username, password };
      if (mode === "register" && displayName) body.displayName = displayName;
      const r = await fetch(`${apiBase}/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "auth_failed");
      onAuth(data as AuthResponse);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>Skilling MMO</h1>
        <p>Chop trees. Trade logs. Grow skills.</p>
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        <label>
          Display name (register)
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <div className="row">
          <button type="button" disabled={busy} onClick={() => submit("login")}>
            Log in
          </button>
          <button type="button" disabled={busy} onClick={() => submit("register")}>
            Register
          </button>
        </div>
        {error && <div className="err">{error}</div>}
      </div>
    </div>
  );
}
