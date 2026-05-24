"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { AtlasiumMark } from "../../components/atlasium-mark";
import { API_BASE_URL, LoginResponse } from "../../lib/client-api";

export default function LoginPage(): JSX.Element {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email, password })
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const data = (await response.json()) as LoginResponse;
      localStorage.setItem("doctoral_token", data.token);
      localStorage.setItem("doctoral_user", JSON.stringify(data.user));
      const returnTo = new URLSearchParams(window.location.search).get("returnTo");
      if (returnTo) {
        try {
          const appOrigin = window.location.origin;
          const target = returnTo.startsWith("/")
            ? new URL(returnTo, appOrigin)
            : new URL(returnTo);
          if (target.origin === appOrigin) {
            router.push(`${target.pathname}${target.search}${target.hash}`);
            return;
          }
        } catch {
          // Ignore invalid or cross-origin returnTo values.
        }
      }
      router.push("/projects");
    } catch (submitError) {
      setError((submitError as Error).message || "Unable to login");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="panel login-panel">
        <div className="login-header">
          <div className="auth-brand-lockup auth-brand-lockup-left">
            <AtlasiumMark size="md" />
            <p className="eyebrow">Atlasium</p>
          </div>
          <h1 className="section-heading">Sign in</h1>
          <p>Use your invited account to access Atlasium.</p>
        </div>

        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            Email or username
            <input
              className="input"
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
            />
          </label>
          <label>
            Password
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </label>

          {error ? <p className="alert alert-error">{error}</p> : null}

          <button className="button" disabled={loading} type="submit">
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
