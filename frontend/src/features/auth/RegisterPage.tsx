import { Link } from 'react-router-dom';
import { PublicHeader } from '../../app/chrome';

export function RegisterPage() {
  return (
    <div className="min-h-screen bg-canvas text-text">
      <PublicHeader />
      <main className="mx-auto flex max-w-md flex-col gap-4 px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Create an account</h1>
        <p className="text-text-muted">Registration is not built yet.</p>
        <Link to="/login" className="text-primary hover:underline">
          Back to sign in
        </Link>
      </main>
    </div>
  );
}
