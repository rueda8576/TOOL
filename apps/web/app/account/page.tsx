"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AppShell } from "../../components/app-shell";
import {
  beginGitlabConnection,
  disconnectGitlabConnection,
  getGitlabConnectionStatus,
  GitlabConnectionStatus
} from "../../lib/gitlab";

export default function AccountPage(): JSX.Element {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [connection, setConnection] = useState<GitlabConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadConnection = useCallback(async (authToken: string): Promise<void> => {
    setLoading(true);
    try {
      const nextConnection = await getGitlabConnectionStatus(authToken);
      setConnection(nextConnection);
      setError(null);
    } catch (loadError) {
      setError((loadError as Error).message || "Unable to load account settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const storedToken = localStorage.getItem("doctoral_token");
    if (!storedToken) {
      router.replace("/login");
      return;
    }

    setToken(storedToken);
    void loadConnection(storedToken);
  }, [loadConnection, router]);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const gitlabQueryState = searchParams.get("gitlab");
    const gitlabQueryMessage = searchParams.get("message");

    if (gitlabQueryState === "connected") {
      setSuccess("GitLab account connected.");
      setError(null);
      return;
    }

    if (gitlabQueryState === "error") {
      setError(gitlabQueryMessage || "GitLab connection failed.");
    }
  }, []);

  const reconnectMessage = useMemo(() => {
    if (!connection?.connected || !connection.reconnectRequired) {
      return null;
    }

    return "Your GitLab session expired or was revoked. Reconnect your account to use Code.";
  }, [connection]);

  const onConnect = async (): Promise<void> => {
    if (!token) {
      setError("Missing session token. Please sign in again.");
      return;
    }

    setConnecting(true);
    setError(null);
    try {
      const response = await beginGitlabConnection(token);
      window.location.assign(response.authorizationUrl);
    } catch (connectError) {
      setError((connectError as Error).message || "Unable to start GitLab connection.");
      setConnecting(false);
    }
  };

  const onDisconnect = async (): Promise<void> => {
    if (!token) {
      setError("Missing session token. Please sign in again.");
      return;
    }

    setDisconnecting(true);
    setError(null);
    setSuccess(null);
    try {
      await disconnectGitlabConnection(token);
      await loadConnection(token);
      setSuccess("GitLab account disconnected.");
    } catch (disconnectError) {
      setError((disconnectError as Error).message || "Unable to disconnect GitLab.");
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <AppShell title="Account" subtitle="Manage your connected services and external identity.">
      <section className="panel stack-md">
        <div className="stack-sm">
          <h2 className="section-heading">GitLab</h2>
          <p>Connect your GitLab account here before using the project Code workspace.</p>
        </div>

        {loading ? <p className="alert alert-info">Loading account settings...</p> : null}
        {error ? <p className="alert alert-error">{error}</p> : null}
        {success ? <p className="alert alert-success">{success}</p> : null}
        {reconnectMessage ? <p className="alert alert-warning">{reconnectMessage}</p> : null}

        {!loading && connection?.connected ? (
          <div className="account-connection-card">
            <div className="stack-xs">
              <p className="eyebrow">Connected account</p>
              <h3 className="section-heading">{connection.name || connection.username}</h3>
              <p>{connection.email || "Email not exposed by GitLab OAuth"}</p>
              <p className="text-muted">@{connection.username}</p>
            </div>
            <div className="button-row">
              {connection.webUrl ? (
                <a className="button button-secondary" href={connection.webUrl} target="_blank" rel="noreferrer">
                  Open in GitLab
                </a>
              ) : null}
              <button className="button button-secondary" type="button" onClick={() => void onConnect()} disabled={connecting}>
                {connecting ? "Redirecting..." : connection.reconnectRequired ? "Reconnect GitLab" : "Reconnect"}
              </button>
              <button className="button button-danger" type="button" onClick={() => void onDisconnect()} disabled={disconnecting}>
                {disconnecting ? "Disconnecting..." : "Disconnect"}
              </button>
            </div>
          </div>
        ) : null}

        {!loading && !connection?.connected ? (
          <div className="account-connection-card">
            <div className="stack-xs">
              <p className="eyebrow">No GitLab account connected</p>
              <h3 className="section-heading">Connect GitLab</h3>
              <p>Atlasium will use your own GitLab identity for repository access, branch creation, and merge requests.</p>
            </div>
            <div className="button-row">
              <button className="button" type="button" onClick={() => void onConnect()} disabled={connecting}>
                {connecting ? "Redirecting..." : "Connect GitLab"}
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}
