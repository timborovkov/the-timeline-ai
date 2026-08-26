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

// Expire the legacy root-path cookie on every route. Inside `/app`, preserve an
// existing scoped cookie or migrate the local/legacy preference before the
// sidebar HTML is parsed. Reloading once lets the server render that value, so
// established users never see the old expanded-first hydration frame.
export const SIDEBAR_PREFERENCE_BOOTSTRAP = `(()=>{try{const k='${SIDEBAR_COOKIE_KEY}=',a=location.pathname==='/app'||location.pathname.startsWith('/app/'),v=()=>document.cookie.split('; ').filter(x=>x.startsWith(k)).map(x=>x.slice(k.length)).find(x=>x==='true'||x==='false'),l=a?v():undefined,s=location.protocol==='https:'?'; Secure':'';document.cookie=k+'; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax'+s;if(!a)return;const c=v();if(c!==undefined)return;let p;try{p=localStorage.getItem('${SIDEBAR_STORAGE_KEY}')}catch{}const n=p==='true'||p==='false'?p:l;if(n!=='true'&&n!=='false')return;document.cookie=k+n+'; Path=${COOKIE_PATH}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax'+s;if(v()===n)location.reload()}catch{}})()`;
