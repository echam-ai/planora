/**
 * Inline script for the document head. It runs before first paint and puts the resolved theme
 * on `<html data-theme>`, so the page never flashes the wrong palette while scripts load.
 *
 * It is a string, not a function, because it ships verbatim into the HTML. Keep it in step with
 * `parseThemePreference` / `resolveTheme` in `theme.ts`; `theme.test.tsx` checks they agree.
 * Storage and `matchMedia` can each be unavailable (blocked storage, old browsers), and the
 * script must still leave a valid theme behind, so each is read in its own `try`.
 */
export const THEME_BOOT_SCRIPT = `(function(){var p="system";try{p=localStorage.getItem("planora.theme")}catch(e){}if(p!=="light"&&p!=="dark"&&p!=="colorful")p="system";if(p==="system"){var d=false;try{d=matchMedia("(prefers-color-scheme: dark)").matches}catch(e){}p=d?"dark":"light"}document.documentElement.setAttribute("data-theme",p)})();`;
