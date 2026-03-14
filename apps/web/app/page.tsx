import Link from "next/link";

export default function HomePage(): JSX.Element {
  return (
    <main className="home-shell">
      <section className="panel home-hero">
        <p className="eyebrow">Atlasium</p>
        <h1 className="section-heading">Research collaboration workspace</h1>
        <p className="lede">Secure access for invited team members.</p>
        <div className="home-actions">
          <Link className="button" href="/login">
            Sign in
          </Link>
        </div>
      </section>
    </main>
  );
}
