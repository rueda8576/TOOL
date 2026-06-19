"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

import { AtlasiumMark } from "../../components/atlasium-mark";
import { API_BASE_URL } from "../../lib/client-api";

export default function ForgotPasswordPage(): JSX.Element {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setError("Enter the account email address.");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch(`${API_BASE_URL}/auth/password/reset`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email: trimmedEmail })
      });

      if (!response.ok) {
        throw new Error("Unable to request a password reset.");
      }

      setSuccessMessage("If an Atlasium account matches that address, reset instructions will be sent.");
    } catch (submitError) {
      setError((submitError as Error).message || "Unable to request a password reset.");
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
            <h1 className="section-heading">Reset workspace access</h1>
          </div>
          <p className="login-access-note">Request a password reset link for an invited Atlasium account.</p>
        </div>

        <div className="login-form-panel">
          <form className="form-grid" onSubmit={onSubmit}>
            <label>
              Account email
              <input
                className="input"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoComplete="email"
              />
            </label>

            {error ? <p className="alert alert-error">{error}</p> : null}
            {successMessage ? <p className="alert alert-success">{successMessage}</p> : null}

            <button className="button" disabled={loading} type="submit">
              {loading ? "Sending reset link..." : "Send reset link"}
            </button>

            <p className="projects-toolbar-helper">
              Access restored? <Link href="/login">Return to sign in</Link>.
            </p>
          </form>
        </div>
      </section>
    </main>
  );
}
