import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Outlet, useParams } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import App from './App';
import { AIProvidersPage } from './pages/AIProviders';
const socket = vi.hoisted(() => ({ disconnect: vi.fn(), on: vi.fn(), off: vi.fn() }));
const io = vi.hoisted(() => vi.fn());
vi.mock('socket.io-client', () => ({ io }));

vi.mock('./components/layout/Layout', () => ({ Layout: () => <Outlet /> }));
vi.mock('./components/Dashboard', () => ({ Dashboard: () => <div>Dashboard</div> }));
vi.mock('./components/person/PersonDetail', () => ({ PersonDetail: () => {
  const { dbId, personId } = useParams();
  return <div>Person {dbId}/{personId}</div>;
} }));
vi.mock('./components/ancestry-tree/AncestryTreeView', () => ({ AncestryTreeView: () => {
  const { dbId, personId, viewMode } = useParams();
  return <div>Tree {dbId}/{personId}/{viewMode}</div>;
} }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('production browser routes', () => {
  it.each([
    ['/', 'Dashboard'],
    ['/person/family/ABC', 'Person family/ABC'],
    ['/tree/family/ABC/pedigree', 'Tree family/ABC/pedigree'],
  ])('renders a direct browser entry at %s', async (path, expected) => {
    window.history.replaceState({}, '', path);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => { root.render(<BrowserRouter><App /></BrowserRouter>); });
      expect(container.textContent).toContain(expected);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
  it('exercises the AI Toolkit Socket.IO consumer and disconnects on unmount', async () => {
    io.mockReturnValue(socket);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ providers: [], runs: [] }), {
      headers: { 'Content-Type': 'application/json' },
    })));
    window.history.replaceState({}, '', '/providers');
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => { root.render(<AIProvidersPage />); });
      expect(container.textContent).toContain('AI Providers');
      expect(io).toHaveBeenCalledWith({ path: '/socket.io' });
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
    expect(socket.disconnect).toHaveBeenCalledOnce();
  });

});
