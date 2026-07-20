import { useState } from "react";
import type { AccountAuthResponse } from "@skilling-mmo/shared";

export function AuthPanel({
  apiBase,
  onAccountAuth,
}: {
  apiBase: string;
  onAccountAuth: (res: AccountAuthResponse) => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`${apiBase}/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "auth_failed");
      onAccountAuth(data as AccountAuthResponse);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lobby-screen">
      <div className="lobby-card auth-card">
        <div className="lobby-brand">
          <h1>Skilling MMO</h1>
          <p className="tagline">Choose your path. Master your trade.</p>
        </div>

        <div className="auth-tabs">
          <button
            type="button"
            className={mode === "login" ? "active" : ""}
            onClick={() => setMode("login")}
          >
            Log in
          </button>
          <button
            type="button"
            className={mode === "register" ? "active" : ""}
            onClick={() => setMode("register")}
          >
            Register
          </button>
        </div>

        <label>
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            placeholder="adventurer"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            placeholder="••••••••"
          />
        </label>

        <button type="button" className="primary" disabled={busy} onClick={() => void submit()}>
          {busy ? "Please wait…" : mode === "login" ? "Enter realm" : "Create account"}
        </button>

        {error && <div className="err">{error}</div>}
      </div>
    </div>
  );
}
