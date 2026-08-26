export const SIDEBAR_COOKIE_KEY = 'timeline_sidebar_expanded';
export const SIDEBAR_STORAGE_KEY = 'timeline.sidebar.expanded';

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const COOKIE_PATH = '/app';

export function sidebarExpandedFromCookie(value: string | undefined): boolean {
  return value !== 'false';
}

export function persistSidebarExpanded(expanded: boolean) {
  const value = String(expanded);
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, value);
  } catch {
    // Storage can be blocked; the cookie can still preserve the preference.
  }

  try {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${SIDEBAR_COOKIE_KEY}=${value}; Path=${COOKIE_PATH}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
  } catch {
    // Cookies can be blocked; the in-memory toggle should still work.
  }
}

// Migrate the existing localStorage-only preference before the sidebar HTML is
// parsed. Reloading once lets the server render the migrated cookie value, so
// established users never see the old expanded-first hydration frame.
export const SIDEBAR_PREFERENCE_BOOTSTRAP = `(()=>{if(!location.pathname.startsWith('/app'))return;try{const s=localStorage.getItem('${SIDEBAR_STORAGE_KEY}');if(s!=='true'&&s!=='false')return;const k='${SIDEBAR_COOKIE_KEY}=',c=document.cookie.split('; ').find(v=>v.startsWith(k))?.slice(k.length);if(c!==undefined)return;document.cookie=k+s+'; Path=${COOKIE_PATH}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax'+(location.protocol==='https:'?'; Secure':'');const n=document.cookie.split('; ').find(v=>v.startsWith(k))?.slice(k.length);if(n===s)location.reload()}catch{}})()`;
