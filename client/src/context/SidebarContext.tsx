import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface SidebarContextType {
  isCollapsed: boolean;
  isMobileOpen: boolean;
  expandedDatabases: Set<string>;
  toggleCollapsed: () => void;
  toggleMobile: () => void;
  closeMobile: () => void;
  toggleDatabaseExpanded: (dbId: string) => void;
  expandDatabase: (dbId: string) => void;
}

const SidebarContext = createContext<SidebarContextType | null>(null);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const stored = localStorage.getItem('sidebar-collapsed');
    return stored === 'true';
  });
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [expandedDatabases, setExpandedDatabases] = useState<Set<string>>(() => {
    const stored = localStorage.getItem('sidebar-expanded-databases');
    return stored ? new Set(JSON.parse(stored)) : new Set();
  });

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed(prev => {
      const newValue = !prev;
      localStorage.setItem('sidebar-collapsed', String(newValue));
      return newValue;
    });
  }, []);

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
      localStorage.setItem('sidebar-expanded-databases', JSON.stringify([...next]));
      return next;
    });
  }, []);

  const expandDatabase = useCallback((dbId: string) => {
    setExpandedDatabases(prev => {
      if (prev.has(dbId)) return prev;
      const next = new Set(prev);
      next.add(dbId);
      localStorage.setItem('sidebar-expanded-databases', JSON.stringify([...next]));
      return next;
    });
  }, []);

  return (
    <SidebarContext.Provider value={{
      isCollapsed,
      isMobileOpen,
      expandedDatabases,
      toggleCollapsed,
      toggleMobile,
      closeMobile,
      toggleDatabaseExpanded,
      expandDatabase
    }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return context;
}
