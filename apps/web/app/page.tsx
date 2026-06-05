import Link from "next/link";

import { AtlasiumMark } from "../components/atlasium-mark";

export default function HomePage(): JSX.Element {
  return (
    <main className="home-shell">
      <section className="panel home-hero">
        <div className="home-access-column">
          <div className="home-access-copy">
            <div className="auth-brand-lockup">
              <AtlasiumMark size="lg" />
              <p className="eyebrow">Atlasium</p>
            </div>
            <h1 className="home-hero-title">Research archive access</h1>
            <p className="lede">Secure entry for invited Atlasium project teams.</p>
            <div className="home-actions">
              <Link className="button" href="/login">
                Sign in
              </Link>
            </div>
          </div>
          <div className="home-access-footer" aria-label="Atlasium workspace scope">
            <span>Documents</span>
            <span>Wiki</span>
            <span>Code</span>
            <span>Tasks</span>
            <span>Meetings</span>
          </div>
        </div>

        <div className="home-archive-visual" aria-hidden="true">
          <div className="home-ledger">
            <div className="home-ledger-header">
              <p className="home-ledger-title">Project archive</p>
              <p className="home-ledger-meta">Index</p>
            </div>
            <div className="home-ledger-body">
              <div className="home-ledger-row">
                <p className="home-ledger-value">Published knowledge</p>
                <span className="home-ledger-state">Traceable</span>
              </div>
              <div className="home-ledger-row">
                <p className="home-ledger-value">Document versions</p>
                <span className="home-ledger-state">Compiled</span>
              </div>
              <div className="home-ledger-row">
                <p className="home-ledger-value">Repository history</p>
                <span className="home-ledger-state">Linked</span>
              </div>
              <div className="home-ledger-row">
                <p className="home-ledger-value">Meeting actions</p>
                <span className="home-ledger-state">Assigned</span>
              </div>
            </div>
            <div className="home-ledger-footer">
              <span>Atlasium</span>
              <span>Living archive</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
