"use client";

import Link from "next/link";
import { FormEvent, Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { AtlasiumMark } from "../../components/atlasium-mark";
import { API_BASE_URL } from "../../lib/client-api";

function ResetPasswordForm(): JSX.Element {
  const searchParams = useSearchParams();
  const tokenFromQuery = searchParams.get("token") ?? "";

  const [token, setToken] = useState(tokenFromQuery);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
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
    if (!trimmedToken) {
      setError("Reset token is required.");
      return;
    }
    if (newPassword.length < 8 || confirmPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Password confirmation does not match.");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch(`${API_BASE_URL}/auth/password/reset/confirm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          token: trimmedToken,
          newPassword,
          confirmPassword
        })
      });

      if (!response.ok) {
        throw new Error("This reset link is invalid or expired.");
      }

      setSuccessMessage("Password updated. Sign in with the new password.");
      setNewPassword("");
      setConfirmPassword("");
    } catch (submitError) {
      setError((submitError as Error).message || "Unable to reset password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="panel login-panel">
        <div className="login-header">
          <div>
            <div className="auth-brand-lockup auth-brand-lockup-left">
              <AtlasiumMark size="md" />
              <p className="eyebrow">Atlasium</p>
            </div>
            <h1 className="section-heading">Set a new password</h1>
          </div>
          <p className="login-access-note">Set the replacement password for your Atlasium account.</p>
        </div>

        <div className="login-form-panel">
          <form className="form-grid" onSubmit={onSubmit}>
            <label>
              Reset token
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
              New password
              <input
                className="input"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                minLength={8}
                required
                autoComplete="new-password"
              />
            </label>

            <label>
              Confirm password
              <input
                className="input"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                minLength={8}
                required
                autoComplete="new-password"
              />
            </label>

            {error ? <p className="alert alert-error">{error}</p> : null}
            {successMessage ? <p className="alert alert-success">{successMessage}</p> : null}

            <button className="button" disabled={loading} type="submit">
              {loading ? "Updating password..." : "Update password"}
            </button>

            <p className="projects-toolbar-helper">
              Password updated? <Link href="/login">Sign in</Link>.
            </p>
          </form>
        </div>
      </section>
    </main>
  );
}

function ResetPasswordFallback(): JSX.Element {
  return (
    <main className="login-shell">
      <section className="panel login-panel">
        <div className="login-header">
          <div className="auth-brand-lockup auth-brand-lockup-left">
            <AtlasiumMark size="md" />
            <p className="eyebrow">Atlasium</p>
          </div>
          <h1 className="section-heading">Set a new password</h1>
          <p>Loading reset details...</p>
        </div>
        <div className="login-form-panel">
          <p className="login-access-note">Preparing the reset form.</p>
        </div>
      </section>
    </main>
  );
}

export default function ResetPasswordPage(): JSX.Element {
  return (
    <Suspense fallback={<ResetPasswordFallback />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
