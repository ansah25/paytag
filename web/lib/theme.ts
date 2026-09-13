export type Theme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'paytag-theme';

export const isTheme = (value: unknown): value is Theme =>
  value === 'dark' || value === 'light';

// Runs inline in <head> before first paint (app/layout.tsx) so the page never
// flashes the wrong palette. Kept in a plain module — a 'use client' file can't
// export a string to the server layout. Stored choice wins; otherwise follow
// the OS setting; dark if anything throws (e.g. storage blocked).
export const THEME_INIT_SCRIPT = `(function(){var d=document.documentElement;try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}d.setAttribute('data-theme',t)}catch(e){d.setAttribute('data-theme','dark')}})();`;
