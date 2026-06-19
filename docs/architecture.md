# Architektura systemu i przepływ OAuth 2.0 + PKCE

## 1. Komponenty

| Komponent             | Rola w OAuth 2.0 / OIDC          | Port  |
|-----------------------|-----------------------------------|-------|
| Frontend (React SPA)  | Public Client                     | 3000  |
| Backend (Express)     | Resource Server                   | 8080  |
| Authorization Server  | Authorization Server / IdP        | 9000  |
| Baza danych (auth-db) | Persistent storage dla userów     | 5432  |
| Baza danych (app-db)  | Persistent storage dla aplikacji  | 5433  |

## 2. Pełny przepływ Authorization Code + PKCE

```
   User      Frontend (SPA)      Auth Server      Backend API     App DB
    |             |                    |                |             |
    |---> open ----->                  |                |             |
    |             |                    |                |             |
    |             | 1. generate code_verifier (random 43-128B URL-safe)
    |             |    code_challenge = BASE64URL(SHA256(code_verifier))
    |             |    store code_verifier in sessionStorage
    |             |                    |                |             |
    |             | 2. GET /authorize?response_type=code              |
    |             |    &client_id=bezpsw-spa                          |
    |             |    &redirect_uri=http://localhost:3000/callback   |
    |             |    &scope=openid profile email roles tasks.read   |
    |             |    &code_challenge=...&code_challenge_method=S256 |
    |             |    &state=...&nonce=... ----------->|             |
    |             |                                     |             |
    |<--- login form (HTML) <--- 302 -------------------|             |
    |             |                                     |             |
    | 3. POST username+password ------------------------>             |
    |                                                   |             |
    |                                              verify (bcrypt)----->
    |                                                   |        SELECT *
    |                                                   |<-----------
    |                                                   |             |
    |<--- consent form (HTML) <-------------------------|             |
    | 4. accept ----------------------------------------->            |
    |                                                   |             |
    |             | 5. 302 redirect_uri?code=...&state=... <----------|
    |<------------|                                     |             |
    |             |                                     |             |
    |             | 6. POST /token                                    |
    |             |    grant_type=authorization_code                  |
    |             |    code=...&code_verifier=...(z sessionStorage)   |
    |             |    client_id=bezpsw-spa ----------->|             |
    |             |                                     |             |
    |             |                            verify SHA256(verifier)
    |             |                            == stored challenge ? |
    |             |                                     |             |
    |             |  access_token (JWT, RS256)          |             |
    |             |  id_token (JWT)                     |             |
    |             |  refresh_token (rotated) <----------|             |
    |             |                                     |             |
    |             | 7. GET /api/tasks                                 |
    |             |    Authorization: Bearer <access_token> -------->|
    |                                                                |
    |                                          fetch JWKS (cache 10m)
    |                                          <---------------------|
    |                                          verify RS256 signature
    |                                          check iss, aud, exp,  |
    |                                          scope, roles          |
    |                                                   |             |
    |                                          SELECT tasks WHERE owner_id=sub
    |                                                                 ------>
    |                                                                 <------
    |             | JSON [{...}, ...] <---------------|                |
    |             |                                                    |
    | <--- render tasks                                                |
```

## 3. Walidacja JWT po stronie backendu

1. Wyciągnij `Authorization: Bearer <token>` z requesta.
2. Zdekoduj nagłówek tokenu (alg=RS256, kid=...).
3. Pobierz JWKS z `OIDC_JWKS_URI` (`http://auth-server:9000/jwks`), z cache (10 min).
4. Wybierz klucz publiczny po `kid` i zweryfikuj podpis tokenu (`jose.jwtVerify`).
5. Sprawdź claimy:
   - `iss` == `OIDC_ISSUER`
   - `aud` zawiera `OIDC_AUDIENCE`
   - `exp` w przyszłości
   - `nbf` / `iat` poprawne
6. Sprawdź `scope` (np. `tasks.read` dla GET).
7. Dla endpointów `/api/admin/*` sprawdź `roles` (custom claim) zawiera `admin`.
8. Wstrzyknij `req.user = { sub, name, email, roles, scope }` i kontynuuj.

## 4. Role i custom claims

Authorization Server dorzuca do access_tokenu i id_tokenu **custom claim `roles`**
(tablica stringów, np. `["user","admin"]`). Backend sprawdza tę tablicę w
middleware `requireRole('admin')`.

Mapowanie scopes -> akcje:

| Scope          | Co pozwala?                                  |
|----------------|----------------------------------------------|
| `openid`       | OIDC login                                   |
| `profile`      | Dostęp do imienia, nazwiska                  |
| `email`        | Dostęp do emaila                             |
| `roles`        | Custom: emisja claim `roles` w tokenie       |
| `tasks.read`   | GET /api/tasks, GET /api/admin/tasks         |
| `tasks.write`  | POST/PUT/DELETE /api/tasks                   |

## 5. Sekwencja błędów (PKCE)

- Brak `code_challenge` w `/authorize` -> `400 invalid_request`.
- `code_challenge_method=plain` -> odrzucone (wymuszamy `S256`).
- Wymiana kodu bez `code_verifier` lub z błędnym -> `400 invalid_grant`.
- Próba użycia kodu drugi raz -> `400 invalid_grant` + opcjonalna rewokacja powiązanych tokenów.

## 6. Bezpieczeństwo poza OAuth

- **CORS**: backend ogranicza Origin do `http://localhost:3000`.
- **Helmet**: standardowe nagłówki bezpieczeństwa (CSP, X-Frame-Options, HSTS).
- **bcrypt**: hasła userów hashowane w bazie (`auth-db.users.password_hash`).
- **Walidacja inputu**: backend waliduje typy i długości pól.
- **Brak `client_secret`** w SPA - klient publiczny, kompensowany PKCE.
