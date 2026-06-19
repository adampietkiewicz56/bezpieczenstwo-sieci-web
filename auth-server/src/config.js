const { generateKeyPair, exportJWK } = require('jose');
const Account = require('./account');

const ISSUER = process.env.ISSUER || 'http://localhost:9000';
const CLIENT_ID = process.env.CLIENT_ID || 'bezpsw-spa';
const REDIRECT_URI = process.env.CLIENT_REDIRECT_URI || 'http://localhost:3000/callback';
const POST_LOGOUT_REDIRECT_URI = process.env.CLIENT_POST_LOGOUT_REDIRECT_URI || 'http://localhost:3000/';

const SUPPORTED_SCOPES = [
  'openid',
  'profile',
  'email',
  'roles',
  'offline_access',
  'tasks.read',
  'tasks.write',
];

// Resource indicator (RFC 8707) musi byc absolute URI (URL lub URN).
const RESOURCE_AUDIENCE = 'urn:bezpsw:api';

async function buildConfiguration() {
  // Generujemy parę kluczy RS256 do podpisywania tokenów. Klucz publiczny
  // jest publikowany w JWKS (/jwks) i pobierany przez backend do weryfikacji.
  const { privateKey } = await generateKeyPair('RS256');
  const privateJwk = await exportJWK(privateKey);
  privateJwk.alg = 'RS256';
  privateJwk.use = 'sig';
  privateJwk.kid = 'bezpsw-key-1';

  return {
    clients: [
      {
        client_id: CLIENT_ID,
        // PUBLIC client - brak client_secret. PKCE rekompensuje brak sekretu.
        token_endpoint_auth_method: 'none',
        application_type: 'web',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        redirect_uris: [REDIRECT_URI],
        post_logout_redirect_uris: [POST_LOGOUT_REDIRECT_URI],
        scope: SUPPORTED_SCOPES.join(' '),
      },
    ],

    // -------- PKCE WYMUSZONE -----------------------------------------------
    // required = () => true  =>  KAZDY request /authorize musi miec
    // code_challenge. Akceptujemy tylko S256 (nie 'plain').
    pkce: {
      required: () => true,
      methods: ['S256'],
    },
    // -----------------------------------------------------------------------

    scopes: SUPPORTED_SCOPES,

    claims: {
      openid: ['sub'],
      profile: ['name', 'preferred_username'],
      email: ['email', 'email_verified'],
      roles: ['roles'],
    },

    features: {
      // Wylaczamy wbudowane dev-interactions (UI dla developera).
      // Dostarczamy wlasne login + consent w src/routes.js.
      devInteractions: { enabled: false },

      // Resource Indicators (RFC 8707). Pozwala wydawac JWT access tokeny
      // z konkretnym `aud` (audience = nasze API) i scope.
      resourceIndicators: {
        enabled: true,
        defaultResource: () => RESOURCE_AUDIENCE,
        useGrantedResource: () => true,
        getResourceServerInfo: () => ({
          scope: 'tasks.read tasks.write',
          audience: RESOURCE_AUDIENCE,
          accessTokenFormat: 'jwt',
          accessTokenTTL: 60 * 60,
          jwt: {
            sign: { alg: 'RS256' },
          },
        }),
      },

      // Endpoint /me (UserInfo) - standard OIDC.
      userinfo: { enabled: true },

      // Endpoint logoutu.
      rpInitiatedLogout: { enabled: true },

      // Endpoint introspekcji - przydatny dla resource serverow ktore wola
      // weryfikowac token aktywny call-em do auth servera.
      introspection: { enabled: true },
    },

    findAccount: Account.findAccount,

    // Dorzucamy custom claimy do access tokenu: roles (do RBAC), preferred_username,
    // name, email - zeby backend mogl mirrorowac usera bez dodatkowego wywolania /userinfo.
    extraTokenClaims: async (_ctx, token) => {
      if (token.kind === 'AccessToken' && token.accountId) {
        const account = await Account.findAccount(null, token.accountId);
        if (account) {
          const claims = await account.claims('access_token', 'roles profile email');
          return {
            roles: claims.roles || [],
            name: claims.name,
            preferred_username: claims.preferred_username,
            email: claims.email,
          };
        }
      }
      return undefined;
    },

    cookies: {
      keys: [process.env.COOKIE_SECRET || 'dev-cookie-secret-change-me'],
      short: { sameSite: 'lax' },
      long: { sameSite: 'lax' },
    },

    jwks: { keys: [privateJwk] },

    interactions: {
      url(_ctx, interaction) {
        return `/interaction/${interaction.uid}`;
      },
    },

    ttl: {
      AccessToken: 3600,
      AuthorizationCode: 60,
      IdToken: 3600,
      RefreshToken: 86400,
      Session: 86400,
      Interaction: 600,
      Grant: 86400,
    },

    // Wystarczy aby tokeny w obrebie demo trzymaly poprawny iss.
    // (W Dockerze browser widzi localhost:9000 -> issuer matchuje.)
  };
}

module.exports = {
  buildConfiguration,
  ISSUER,
  CLIENT_ID,
  RESOURCE_AUDIENCE,
  SUPPORTED_SCOPES,
};
