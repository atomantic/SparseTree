import { createContext, useContext, useCallback, useEffect, ReactNode } from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useLocalStorage<Theme>(
    'theme',
    () => window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark',
    String,
    (raw) => raw as Theme
  );

  // Apply theme class to document
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  }, [setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

// Default values for when context is unavailable (e.g., during HMR)
const defaultContext: ThemeContextType = {
  theme: 'dark',
  toggleTheme: () => {},
  setTheme: () => {},
};

export function useTheme() {
  const context = useContext(ThemeContext);
  // Return default context during HMR transitions instead of throwing
  if (!context) {
    if (import.meta.env.DEV) {
      console.warn('useTheme: context unavailable, using defaults (HMR transition)');
      return defaultContext;
    }
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
