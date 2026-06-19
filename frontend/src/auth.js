import { UserManager, WebStorageStateStore } from 'oidc-client-ts';

const cfg = {
  authority: import.meta.env.VITE_OIDC_AUTHORITY,
  client_id: import.meta.env.VITE_OIDC_CLIENT_ID,
  redirect_uri: import.meta.env.VITE_OIDC_REDIRECT_URI,
  post_logout_redirect_uri: import.meta.env.VITE_OIDC_POST_LOGOUT_REDIRECT_URI,
  response_type: 'code',
  // Wszystkie potrzebne scope - openid (OIDC), profile/email (claimy),
  // roles (custom claim w access tokenie), tasks.* (uprawnienia w API),
  // offline_access (refresh token).
  scope: 'openid profile email roles tasks.read tasks.write offline_access',
  // Resource indicator (RFC 8707) - access token bedzie mial aud=urn:bezpsw:api,
  // co backend wymusza w walidacji JWT.
  extraQueryParams: {
    resource: import.meta.env.VITE_API_AUDIENCE,
  },
  // Nie wolamy /userinfo - claimy sa juz w access tokenie.
  loadUserInfo: false,
  userStore: new WebStorageStateStore({ store: window.localStorage }),
  // PKCE jest wlaczone domyslnie dla response_type=code. Biblioteka generuje
  // code_verifier (kryptograficznie losowy) i code_challenge=SHA256(verifier).
  // Verifier przechowywany jest w sessionStorage do momentu callbacku.
  monitorSession: false,
};

export const userManager = new UserManager(cfg);

export async function login() {
  await userManager.signinRedirect();
}

export async function logout() {
  await userManager.signoutRedirect();
}

export async function handleCallback() {
  return userManager.signinRedirectCallback();
}

export async function getUser() {
  const u = await userManager.getUser();
  if (!u || u.expired) return null;
  return u;
}
