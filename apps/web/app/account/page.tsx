"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AppShell } from "../../components/app-shell";
import {
  beginGitlabConnection,
  createGitlabSshKey,
  deleteGitlabSshKey,
  disconnectGitlabConnection,
  getGitlabConnectionStatus,
  GitlabConnectionStatus,
  GitlabSshKey,
  listGitlabSshKeys
} from "../../lib/gitlab";

export default function AccountPage(): JSX.Element {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [connection, setConnection] = useState<GitlabConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [sshKeys, setSshKeys] = useState<GitlabSshKey[]>([]);
  const [sshKeysLoading, setSshKeysLoading] = useState(false);
  const [creatingSshKey, setCreatingSshKey] = useState(false);
  const [deletingKeyId, setDeletingKeyId] = useState<number | null>(null);
  const [sshKeyTitle, setSshKeyTitle] = useState("");
  const [sshPublicKey, setSshPublicKey] = useState("");
  const [sshKeyExpiresAt, setSshKeyExpiresAt] = useState("");
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

  const loadSshKeys = useCallback(async (authToken: string): Promise<void> => {
    setSshKeysLoading(true);
    try {
      const nextKeys = await listGitlabSshKeys(authToken);
      setSshKeys(nextKeys);
      setError(null);
    } catch (loadError) {
      setError((loadError as Error).message || "Unable to load GitLab SSH keys.");
    } finally {
      setSshKeysLoading(false);
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

  useEffect(() => {
    if (!token || !connection?.connected || connection.reconnectRequired) {
      setSshKeys([]);
      return;
    }

    void loadSshKeys(token);
  }, [connection, loadSshKeys, token]);

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

  const onCreateSshKey = async (): Promise<void> => {
    if (!token) {
      setError("Missing session token. Please sign in again.");
      return;
    }

    setCreatingSshKey(true);
    setError(null);
    setSuccess(null);
    try {
      await createGitlabSshKey(token, {
        title: sshKeyTitle.trim(),
        key: sshPublicKey.trim(),
        ...(sshKeyExpiresAt.trim() ? { expiresAt: sshKeyExpiresAt.trim() } : {})
      });
      setSshKeyTitle("");
      setSshPublicKey("");
      setSshKeyExpiresAt("");
      await loadSshKeys(token);
      setSuccess("GitLab SSH key added.");
    } catch (createError) {
      setError((createError as Error).message || "Unable to add the GitLab SSH key.");
    } finally {
      setCreatingSshKey(false);
    }
  };

  const onDeleteSshKey = async (keyId: number): Promise<void> => {
    if (!token) {
      setError("Missing session token. Please sign in again.");
      return;
    }

    setDeletingKeyId(keyId);
    setError(null);
    setSuccess(null);
    try {
      await deleteGitlabSshKey(token, keyId);
      await loadSshKeys(token);
      setSuccess("GitLab SSH key removed.");
    } catch (deleteError) {
      setError((deleteError as Error).message || "Unable to remove the GitLab SSH key.");
    } finally {
      setDeletingKeyId(null);
    }
  };

  return (
    <AppShell title="Account" subtitle="Manage your connected services and Atlasium-linked developer identity.">
      <section className="panel stack-md">
        <div className="stack-sm">
          <h2 className="section-heading">GitLab</h2>
          <p>GitLab web sign-in uses Atlasium SSO. Connect GitLab API access here and manage the SSH keys used for `git clone`, `pull`, and `push`.</p>
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
              <p className="eyebrow">No GitLab API access connected</p>
              <h3 className="section-heading">Connect GitLab</h3>
              <p>Atlasium will use your GitLab identity for managed repository browsing, branch creation, and merge requests.</p>
            </div>
            <div className="button-row">
              <button className="button" type="button" onClick={() => void onConnect()} disabled={connecting}>
                {connecting ? "Redirecting..." : "Connect GitLab"}
              </button>
            </div>
          </div>
        ) : null}

        {!loading && connection?.connected && !connection.reconnectRequired ? (
          <section className="panel panel-subtle stack-md">
            <div className="stack-xs">
              <p className="eyebrow">SSH keys</p>
              <h3 className="section-heading">CLI Git access</h3>
              <p>Add an SSH public key to your Atlasium-managed GitLab identity so `Code` can use SSH as the primary clone method.</p>
              <p className="text-muted">
                Recommended command:{" "}
                <code className="account-ssh-hint">ssh-keygen -t ed25519 -C "{connection.email || "your-email"}"</code>
              </p>
              <p className="text-muted">Paste the contents of the generated `.pub` file here.</p>
            </div>

            <div className="account-ssh-grid">
              <section className="stack-sm">
                <h4 className="section-heading">Current keys</h4>
                {sshKeysLoading ? <p className="alert alert-info">Loading SSH keys...</p> : null}
                <div className="stack-sm account-ssh-list">
                  {!sshKeysLoading && sshKeys.length === 0 ? (
                    <p className="text-muted">No SSH keys added yet. Add at least one key to use SSH clone from Atlasium Code.</p>
                  ) : null}
                  {sshKeys.map((sshKey) => (
                    <article key={sshKey.id} className="account-ssh-card">
                      <div className="stack-xs">
                        <div className="button-row">
                          <strong>{sshKey.title}</strong>
                          {sshKey.usageType ? <span className="badge">{sshKey.usageType}</span> : null}
                        </div>
                        <p className="text-muted">
                          Added {new Date(sshKey.createdAt).toLocaleDateString()}
                          {sshKey.expiresAt ? ` · Expires ${sshKey.expiresAt}` : " · No expiration"}
                        </p>
                        <code className="account-ssh-key-preview">{sshKey.key}</code>
                      </div>
                      <button
                        className="button button-danger"
                        type="button"
                        onClick={() => void onDeleteSshKey(sshKey.id)}
                        disabled={deletingKeyId === sshKey.id}
                      >
                        {deletingKeyId === sshKey.id ? "Removing..." : "Remove"}
                      </button>
                    </article>
                  ))}
                </div>
              </section>

              <section className="stack-sm">
                <h4 className="section-heading">Add SSH key</h4>
                <label>
                  Title
                  <input className="input" value={sshKeyTitle} onChange={(event) => setSshKeyTitle(event.target.value)} placeholder="Laptop" />
                </label>
                <label>
                  Public key
                  <textarea
                    className="textarea account-ssh-key-textarea"
                    value={sshPublicKey}
                    onChange={(event) => setSshPublicKey(event.target.value)}
                    rows={6}
                    placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA..."
                  />
                </label>
                <label>
                  Expiration date
                  <input className="input" type="date" value={sshKeyExpiresAt} onChange={(event) => setSshKeyExpiresAt(event.target.value)} />
                </label>
                <div className="button-row">
                  <button
                    className="button"
                    type="button"
                    onClick={() => void onCreateSshKey()}
                    disabled={creatingSshKey || !sshKeyTitle.trim() || !sshPublicKey.trim()}
                  >
                    {creatingSshKey ? "Adding..." : "Add SSH key"}
                  </button>
                </div>
              </section>
            </div>
          </section>
        ) : null}
      </section>
    </AppShell>
  );
}
