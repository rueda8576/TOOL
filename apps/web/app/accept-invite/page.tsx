"use client";

import Link from "next/link";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { API_BASE_URL } from "../../lib/client-api";

type AcceptInviteResponse = {
  token: string;
  userId: string;
  projectId?: string | null;
  projectIds: string[];
};

function AcceptInviteForm(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tokenFromQuery = searchParams.get("token") ?? "";

  const [token, setToken] = useState(tokenFromQuery);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (tokenFromQuery) {
      setToken(tokenFromQuery);
    }
  }, [tokenFromQuery]);

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();

    const trimmedToken = token.trim();
    const trimmedName = name.trim();
    if (!trimmedToken || !trimmedName || password.length < 8) {
      setError("Token, name, and password (min 8 characters) are required.");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch(`${API_BASE_URL}/auth/accept-invite`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          token: trimmedToken,
          name: trimmedName,
          password
        })
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const data = (await response.json()) as AcceptInviteResponse;
      const assignedCount = data.projectIds.length;
      setSuccessMessage(
        assignedCount > 0
          ? `Account created. Assigned to ${assignedCount} project${assignedCount === 1 ? "" : "s"}. Redirecting to login...`
          : "Account created. Redirecting to login..."
      );
      setTimeout(() => {
        router.replace("/login");
      }, 1400);
    } catch (submitError) {
      setError((submitError as Error).message || "Unable to accept invitation");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="panel login-panel">
        <div className="login-header">
          <h1 className="section-heading">Accept invitation</h1>
          <p>Create your account to join Atlasium.</p>
        </div>

        <form className="form-grid" onSubmit={onSubmit}>
          <label>
            Invitation token
            <input
              className="input"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              required
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          <label>
            Full name
            <input className="input" value={name} onChange={(event) => setName(event.target.value)} required autoComplete="name" />
          </label>

          <label>
            Password
            <input
              className="input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              required
              autoComplete="new-password"
            />
          </label>

          {error ? <p className="alert alert-error">{error}</p> : null}
          {successMessage ? <p className="alert alert-success">{successMessage}</p> : null}

          <button className="button" disabled={loading} type="submit">
            {loading ? "Creating account..." : "Create account"}
          </button>

          <p className="projects-toolbar-helper">
            Already have an account? <Link href="/login">Sign in</Link>.
          </p>
        </form>
      </section>
    </main>
  );
}

function AcceptInviteFallback(): JSX.Element {
  return (
    <main className="login-shell">
      <section className="panel login-panel">
        <div className="login-header">
          <h1 className="section-heading">Accept invitation</h1>
          <p>Loading invite details...</p>
        </div>
      </section>
    </main>
  );
}

export default function AcceptInvitePage(): JSX.Element {
  return (
    <Suspense fallback={<AcceptInviteFallback />}>
      <AcceptInviteForm />
    </Suspense>
  );
}
