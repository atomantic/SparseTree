import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import type { DatabaseInfo } from '@fsf/shared';
import { api } from '../services/api';
import { useLocalStorage } from '../hooks/useLocalStorage';

interface SidebarContextType {
  isCollapsed: boolean;
  isMobileOpen: boolean;
  expandedDatabases: Set<string>;
  databases: DatabaseInfo[];
  toggleCollapsed: () => void;
  toggleMobile: () => void;
  closeMobile: () => void;
  toggleDatabaseExpanded: (dbId: string) => void;
  expandDatabase: (dbId: string) => void;
  refreshDatabases: () => Promise<void>;
}

const SidebarContext = createContext<SidebarContextType | null>(null);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [isCollapsed, setIsCollapsed] = useLocalStorage(
    'sidebar-collapsed',
    false,
    String,
    (raw) => raw === 'true'
  );
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [expandedDatabases, setExpandedDatabases] = useLocalStorage<Set<string>>(
    'sidebar-expanded-databases',
    () => new Set(),
    (s) => JSON.stringify([...s]),
    (raw) => new Set(JSON.parse(raw))
  );

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed(prev => !prev);
  }, [setIsCollapsed]);

  const toggleMobile = useCallback(() => {
    setIsMobileOpen(prev => !prev);
  }, []);

  const closeMobile = useCallback(() => {
    setIsMobileOpen(false);
  }, []);

  const toggleDatabaseExpanded = useCallback((dbId: string) => {
    setExpandedDatabases(prev => {
      const next = new Set(prev);
      if (next.has(dbId)) {
        next.delete(dbId);
      } else {
        next.add(dbId);
      }
      return next;
    });
  }, [setExpandedDatabases]);

  const expandDatabase = useCallback((dbId: string) => {
    setExpandedDatabases(prev => {
      if (prev.has(dbId)) return prev;
      const next = new Set(prev);
      next.add(dbId);
      return next;
    });
  }, [setExpandedDatabases]);

  // Database state management
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);

  const refreshDatabases = useCallback(async () => {
    const dbs = await api.listDatabases().catch(() => []);
    setDatabases(dbs);
  }, []);

  // Fetch databases on mount
  useEffect(() => {
    refreshDatabases();
  }, [refreshDatabases]);

  return (
    <SidebarContext.Provider value={{
      isCollapsed,
      isMobileOpen,
      expandedDatabases,
      databases,
      toggleCollapsed,
      toggleMobile,
      closeMobile,
      toggleDatabaseExpanded,
      expandDatabase,
      refreshDatabases
    }}>
      {children}
    </SidebarContext.Provider>
  );
}

// Default values for when context is unavailable (e.g., during HMR)
const defaultContext: SidebarContextType = {
  isCollapsed: false,
  isMobileOpen: false,
  expandedDatabases: new Set(),
  databases: [],
  toggleCollapsed: () => {},
  toggleMobile: () => {},
  closeMobile: () => {},
  toggleDatabaseExpanded: () => {},
  expandDatabase: () => {},
  refreshDatabases: async () => {},
};

export function useSidebar() {
  const context = useContext(SidebarContext);
  // Return default context during HMR transitions instead of throwing
  // This prevents crashes during development hot reloads
  if (!context) {
    if (import.meta.env.DEV) {
      console.warn('useSidebar: context unavailable, using defaults (HMR transition)');
      return defaultContext;
    }
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return context;
}
