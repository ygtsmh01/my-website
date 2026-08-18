import React, { createContext, useContext, useEffect, useState } from 'react';

const THEME_KEY = 'aitakip_theme';
type Theme = 'dark' | 'light';

interface ThemeCtx {
  theme: Theme;
  toggleTheme: () => void;
}

const Ctx = createContext<ThemeCtx>({ theme: 'dark', toggleTheme: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem(THEME_KEY) as Theme) || 'dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  return <Ctx.Provider value={{ theme, toggleTheme }}>{children}</Ctx.Provider>;
}

export function useTheme() {
  return useContext(Ctx);
}
