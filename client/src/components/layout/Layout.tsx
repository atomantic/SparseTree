import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Sidebar } from './Sidebar';

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-8 h-8 animate-spin text-app-text-muted" />
    </div>
  );
}

export function Layout() {
  return (
    <div className="h-screen flex bg-app-bg overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="md:hidden h-14" /> {/* Spacer for mobile hamburger */}
        <Suspense fallback={<PageLoader />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
