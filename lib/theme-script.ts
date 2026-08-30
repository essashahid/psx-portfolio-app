/**
 * Applies the stored theme before the first paint.
 *
 * This has to run as a blocking inline script in <head>. Doing it in React
 * would be too late: the browser would paint the light palette first and then
 * repaint dark, which reads as a white flash on every navigation and is worst
 * in exactly the situation dark mode is for, a dark room.
 *
 * Kept deliberately tiny and dependency-free, and it fails open to the system
 * preference if storage is unavailable (private windows, blocked site data).
 */
export const THEME_STORAGE_KEY = "plumb.theme";

export const themeInitScript = `(function(){try{var m=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY
)});if(m==="dark"||m==="light"){document.documentElement.setAttribute("data-theme",m);}}catch(e){}})();`;
