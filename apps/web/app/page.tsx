import Link from "next/link";

import { AtlasiumMark } from "../components/atlasium-mark";

export default function HomePage(): JSX.Element {
  return (
    <main className="home-shell">
      <section className="panel home-hero">
        <div className="auth-brand-lockup">
          <AtlasiumMark size="lg" />
          <p className="eyebrow">Atlasium</p>
        </div>
        <h1 className="section-heading">Research archive access</h1>
        <p className="lede">Secure entry for invited Atlasium project teams.</p>
        <div className="home-actions">
          <Link className="button" href="/login">
            Sign in
          </Link>
        </div>
      </section>
    </main>
  );
}
