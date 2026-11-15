// Session state: token, logged-in user, settings.

const TOKEN_KEY = 'gm.token';
let memToken = null;

export const session = {
  user: null,
  settings: {},
  info: null,
  canSeeCost: false,
};

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || memToken;
  } catch {
    return memToken;
  }
}

export function setToken(token) {
  memToken = token;
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* private mode: keep in memory */
  }
}

export function clearSession() {
  memToken = null;
  session.user = null;
  session.settings = {};
  session.canSeeCost = false;
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export const ROLES = { OWNER: 'owner', INVENTORY: 'inventory', DESK: 'front_desk', MECHANIC: 'mechanic' };

export function hasRole(...roles) {
  return !!session.user && roles.includes(session.user.role);
}

/** Per-person permission ticked by the owner (see PERMISSIONS in api/lib/auth.php); any of the keys. */
export function can(...perms) {
  const u = session.user;
  if (!u) return false;
  if (u.role === 'owner') return true;
  return perms.some((p) => !!u.perms?.[p]);
}

export function setting(key, fallback = '') {
  const v = session.settings ? session.settings[key] : undefined;
  return v === undefined || v === null ? fallback : v;
}
