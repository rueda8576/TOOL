export type AccountGitCredentialHelper = {
  id: string;
  platform: string;
  command: string;
  detail: string;
};

export function AccountGitCredentialSetup({
  copiedHelperId,
  detailsOpen,
  helpers,
  onCopyHelper,
  onToggleDetails,
  username
}: {
  copiedHelperId: string | null;
  detailsOpen: boolean;
  helpers: readonly AccountGitCredentialHelper[];
  onCopyHelper: (helperId: string, command: string) => void | Promise<void>;
  onToggleDetails: () => void;
  username: string;
}): JSX.Element {
  return (
    <>
      <div className="account-credential-setup">
        <div className="stack-xxs">
          <h4 className="account-setup-title">Store credentials on this computer</h4>
          <p className="account-setup-summary">Atlasium syncs the password to GitLab. Your computer saves the Git credential after the next prompt.</p>
        </div>
        <ol className="account-setup-steps">
          <li>Sync the HTTPS password above.</li>
          <li>Run the credential helper command for your platform.</li>
          <li>On the next clone, pull, or push, enter <strong>{username}</strong> and your Atlasium password once.</li>
        </ol>
        <div className="account-platform-list">
          {helpers.map((helper) => (
            <div className="account-platform-row" key={helper.id}>
              <div className="stack-xxs account-platform-copy">
                <p className="account-platform-name">{helper.platform}</p>
                <p className="account-platform-detail">{helper.detail}</p>
              </div>
              <code className="account-platform-command">{helper.command}</code>
              <button
                className="button button-secondary account-command-copy"
                type="button"
                aria-label={`Copy ${helper.platform} credential helper command`}
                onClick={() => void onCopyHelper(helper.id, helper.command)}
              >
                {copiedHelperId === helper.id ? "Copied" : "Copy"}
              </button>
            </div>
          ))}
        </div>
      </div>

      <button
        className="inline-link-button account-details-toggle"
        type="button"
        onClick={onToggleDetails}
        aria-expanded={detailsOpen}
      >
        {detailsOpen ? "Hide reset or examples" : "Reset or examples"}
      </button>

      {detailsOpen ? (
        <div className="account-command-panel stack-xs">
          <p className="account-ssh-meta-label">Reset saved HTTPS credentials</p>
          <code className="account-ssh-hint">{`@"\nprotocol=https\nhost=git.atlasium.info\n\n"@ | git credential-manager erase`}</code>
          <p className="account-command-note">Use this if Git keeps using an old password or account for <code>git.atlasium.info</code>.</p>
          <p className="account-ssh-meta-label">Clone URL pattern</p>
          <code className="account-ssh-hint">git clone https://{username}@git.atlasium.info/&lt;group&gt;/&lt;repo&gt;.git</code>
        </div>
      ) : null}
    </>
  );
}
