import { Link } from 'react-router-dom';
import { PublicHeader } from './chrome';

export function NotFound() {
  return (
    <div className="min-h-screen bg-canvas text-text">
      <PublicHeader />
      <main className="mx-auto flex max-w-md flex-col items-start gap-4 px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="text-text-muted">That page doesn’t exist.</p>
        <Link to="/" className="text-primary hover:underline">
          Go home
        </Link>
      </main>
    </div>
  );
}
