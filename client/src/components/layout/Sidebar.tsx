import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, Download, Bot, GitBranch, Search, Route, ChevronLeft, ChevronRight, ChevronDown, X, Menu, Database, Star, Network, Sun, Moon, Monitor, FileBarChart } from 'lucide-react';
import { useSidebar } from '../../context/SidebarContext';
import { useTheme } from '../../context/ThemeContext';
import type { DatabaseInfo } from '@fsf/shared';

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
}

// Primary nav items (always visible at top)
const topNavItems: NavItem[] = [
  { path: '/', label: 'Dashboard', icon: <Home size={20} /> },
  { path: '/favorites', label: 'Favorites', icon: <Star size={20} /> },
  { path: '/indexer', label: 'Indexer', icon: <Download size={20} /> },
];

// Bottom nav items (settings/providers)
const bottomNavItems: NavItem[] = [
  { path: '/providers/genealogy', label: 'Genealogy Providers', icon: <Database size={20} /> },
  { path: '/providers', label: 'AI Providers', icon: <Bot size={20} /> },
  { path: '/settings/browser', label: 'Browser Settings', icon: <Monitor size={20} /> },
  { path: '/settings/reports', label: 'Test Reports', icon: <FileBarChart size={20} /> },
];

// Database sub-pages
const getDatabaseSubPages = (dbId: string): NavItem[] => [
  { path: `/tree/${dbId}`, label: 'Tree View', icon: <GitBranch size={18} /> },
  { path: `/search/${dbId}`, label: 'Search', icon: <Search size={18} /> },
  { path: `/path/${dbId}`, label: 'Find Path', icon: <Route size={18} /> },
  { path: `/favorites/sparse-tree/${dbId}`, label: 'Sparse Tree', icon: <Network size={18} /> },
  { path: `/db/${dbId}/favorites`, label: 'Favorites', icon: <Star size={18} /> },
];

export function Sidebar() {
  const location = useLocation();
  const { isCollapsed, isMobileOpen, expandedDatabases, databases, toggleCollapsed, toggleMobile, closeMobile, toggleDatabaseExpanded, expandDatabase } = useSidebar();
  const { theme, toggleTheme } = useTheme();

  // Extract dbId from current path and auto-expand that database
  const currentDbId = extractDbIdFromPath(location.pathname);
  useEffect(() => {
    if (currentDbId) {
      expandDatabase(currentDbId);
    }
  }, [currentDbId, expandDatabase]);

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    // For /providers, only match exactly (not /providers/genealogy)
    if (path === '/providers') return location.pathname === '/providers';
    // For /favorites, only match exactly (not /favorites/sparse-tree or db-scoped)
    if (path === '/favorites') return location.pathname === '/favorites';
    return location.pathname.startsWith(path);
  };

  const navLinkClasses = (path: string, indent = false) => `
    flex items-center gap-3 px-3 py-2 rounded-lg transition-colors
    ${isActive(path)
      ? 'bg-app-accent text-app-text'
      : 'text-app-text-muted hover:bg-app-hover hover:text-app-text'
    }
    ${isCollapsed ? 'justify-center' : ''}
    ${indent && !isCollapsed ? 'pl-6' : ''}
  `;

  const renderNavItem = (item: NavItem, indent = false) => (
    <Link
      key={item.path}
      to={item.path}
      className={navLinkClasses(item.path, indent)}
      onClick={closeMobile}
      title={isCollapsed ? item.label : undefined}
    >
      {item.icon}
      {!isCollapsed && <span className={indent ? 'text-sm' : ''}>{item.label}</span>}
    </Link>
  );

  const renderDatabaseItem = (db: DatabaseInfo) => {
    const isExpanded = expandedDatabases.has(db.id);
    const subPages = getDatabaseSubPages(db.id);
    const isDbActive = subPages.some(page => isActive(page.path));
    const displayName = db.rootName || db.id.replace('db-', '');

    return (
      <div key={db.id}>
        <button
          onClick={() => toggleDatabaseExpanded(db.id)}
          className={`
            w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-colors
            ${isDbActive
              ? 'text-app-text bg-app-hover'
              : 'text-app-text-muted hover:bg-app-hover hover:text-app-text'
            }
            ${isCollapsed ? 'justify-center' : ''}
          `}
          title={isCollapsed ? displayName : undefined}
        >
          <Database size={18} className="flex-shrink-0" />
          {!isCollapsed && (
            <>
              <span className="flex-1 text-left truncate text-sm">{displayName}</span>
              <ChevronDown
                size={16}
                className={`flex-shrink-0 transition-transform ${isExpanded ? 'rotate-0' : '-rotate-90'}`}
              />
            </>
          )}
        </button>

        {/* Sub-pages (expanded view) */}
        {!isCollapsed && isExpanded && (
          <div className="ml-3 mt-1 space-y-0.5 border-l border-app-border pl-2">
            {subPages.map(item => renderNavItem(item, true))}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        onClick={toggleMobile}
        className="fixed top-4 left-4 z-50 p-2 rounded-lg bg-app-card border border-app-border text-app-text md:hidden"
        aria-label="Toggle menu"
      >
        {isMobileOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Mobile overlay */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-app-overlay z-40 md:hidden"
          onClick={closeMobile}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed top-0 left-0 h-screen bg-app-card border-r border-app-border z-40
          transition-all duration-300 flex flex-col flex-shrink-0
          ${isCollapsed ? 'w-16' : 'w-64'}
          ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'}
          md:translate-x-0 md:sticky
        `}
      >
        {/* Logo / Brand */}
        <div className={`p-4 border-b border-app-border flex items-center ${isCollapsed ? 'justify-center' : 'justify-between'}`}>
          {!isCollapsed && (
            <Link to="/" className="text-lg font-bold text-app-text truncate" onClick={closeMobile}>
              SparseTree
            </Link>
          )}
          <button
            onClick={toggleCollapsed}
            className="p-1.5 rounded-lg text-app-text-muted hover:bg-app-hover hover:text-app-text hidden md:block"
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {/* Top nav items */}
          {topNavItems.map(item => renderNavItem(item))}

          {/* Databases Section */}
          {databases.length > 0 && (
            <>
              <div className={`pt-4 pb-2 ${isCollapsed ? 'border-t border-app-border mt-4' : ''}`}>
                {!isCollapsed && (
                  <span className="px-3 text-xs font-semibold text-app-text-muted uppercase tracking-wider">
                    Databases
                  </span>
                )}
              </div>
              {databases.map(db => renderDatabaseItem(db))}
            </>
          )}

          {/* Separator before settings */}
          <div className={`pt-4 pb-2 ${isCollapsed ? 'border-t border-app-border mt-4' : ''}`}>
            {!isCollapsed && (
              <span className="px-3 text-xs font-semibold text-app-text-muted uppercase tracking-wider">
                Settings
              </span>
            )}
          </div>

          {/* Bottom nav items */}
          {bottomNavItems.map(item => renderNavItem(item))}
        </nav>

        {/* Theme Toggle */}
        <div className={`p-3 border-t border-app-border ${isCollapsed ? 'flex justify-center' : ''}`}>
          <button
            onClick={toggleTheme}
            className={`
              flex items-center gap-3 px-3 py-2 rounded-lg transition-colors w-full
              text-app-text-muted hover:bg-app-hover hover:text-app-text
              ${isCollapsed ? 'justify-center' : ''}
            `}
            title={isCollapsed ? (theme === 'dark' ? 'Dark Mode (click for light)' : 'Light Mode (click for dark)') : undefined}
          >
            {theme === 'dark' ? <Moon size={20} /> : <Sun size={20} />}
            {!isCollapsed && <span>{theme === 'dark' ? 'Dark Mode' : 'Light Mode'}</span>}
          </button>
        </div>
      </aside>
    </>
  );
}

function extractDbIdFromPath(pathname: string): string | null {
  // Match patterns like /tree/db-XXX, /search/db-XXX, /path/db-XXX, /person/db-XXX/YYY, /favorites/sparse-tree/db-XXX, /db/db-XXX/favorites
  const patterns = [
    /^\/tree\/(db-[^/]+)/,
    /^\/search\/(db-[^/]+)/,
    /^\/path\/(db-[^/]+)/,
    /^\/person\/(db-[^/]+)/,
    /^\/favorites\/sparse-tree\/(db-[^/]+)/,
    /^\/db\/(db-[^/]+)/,
  ];

  for (const pattern of patterns) {
    const match = pathname.match(pattern);
    if (match) return match[1];
  }

  return null;
}
