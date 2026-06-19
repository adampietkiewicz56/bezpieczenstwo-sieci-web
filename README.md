# Bezpieczna aplikacja webowa z OAuth 2.0 / OIDC + PKCE

**Autor:** Adam Pietkiewicz
**Grupa:** _<TU_WPISZ_NUMER_GRUPY>_
**Przedmiot:** Bezpieczeństwo aplikacji webowych
**Termin:** 19.06.2026

> Projekt zaliczeniowy demonstrujący zabezpieczenie aplikacji webowej standardem **OAuth 2.0 / OpenID Connect**
> z obowiązkowym **PKCE** (Proof Key for Code Exchange), niezależnym **Authorization Serverem** (nie Keycloak),
> backendem-API jako Resource Server, frontendem SPA jako Public Client oraz pełną konteneryzacją (Docker Compose),
> testami automatycznymi i pipeline'em CI/CD (GitHub Actions).

---

## 1. Spełnienie wymagań projektu

### Poziom 3.0 (minimum)
- [x] Backend zabezpieczony OAuth 2.0 (walidacja JWT przez JWKS)
- [x] Przynajmniej 1 endpoint uwzględniający rolę użytkownika (`/api/admin/*`)
- [x] Przynajmniej 4 zabezpieczone endpointy (`/api/profile`, `/api/tasks` GET/POST/PUT/DELETE, `/api/admin/tasks`, `/api/admin/users`)
- [x] Przynajmniej 1 niezabezpieczony endpoint (`/health`, `/ready`)
- [x] Frontend korzystający z backendu (React SPA z `oidc-client-ts`)
- [x] Baza danych (PostgreSQL z wolumenem)
- [x] Skonfigurowany Authorization Server (`auth-server` oparty o `node-oidc-provider`)
- [x] Włączone PKCE - wymuszone w konfiguracji (`pkce.required = () => true`)

### Poziom wyższy
- [x] **Docker Compose** orkiestrujący wszystkie komponenty
- [x] **Inny Authorization Server niż Keycloak** - własny serwer OIDC oparty o `node-oidc-provider` (panva)
- [x] **Rozbudowana logika biznesowa** - system zarządzania zadaniami z rolami USER/ADMIN, statusami, terminami, przypisaniami
- [x] **Testy automatyczne** - Jest + Supertest (auth-server, backend)
- [x] **CI/CD** - GitHub Actions (lint, test, build, docker)
- [x] **Wolumen danych dla Authorization Server** - `auth-pgdata` (Docker named volume)

---

## 2. Architektura systemu

```
                       ┌───────────────────────────┐
                       │      Browser (User)       │
                       │  React SPA  (Public Client)│
                       └─────────────┬─────────────┘
                                     │
              (1) GET /authorize?... │ (2) login + consent
                 + code_challenge    │ (3) 302 redirect z code
                                     ▼
       ┌─────────────────────────────────────────────────────┐
       │  Authorization Server (node-oidc-provider, :9000)   │
       │  - Endpoint /authorize, /token, /jwks, /me          │
       │  - PKCE wymuszone (S256)                            │
       │  - Login + consent UI (EJS)                         │
       └─────────────┬───────────────────────────┬───────────┘
                     │                           │
        (4) POST /token                          │ JWKS
            + code + code_verifier               │ (klucz publiczny)
                     │                           │
                     ▼                           ▼
       ┌─────────────────────────┐   ┌──────────────────────────┐
       │  PostgreSQL (auth)      │   │  Backend API (:8080)     │
       │  users, roles           │   │  Express + Resource Srv  │
       │  Volume: auth-pgdata    │   │  Walidacja JWT (JWKS)    │
       └─────────────────────────┘   │  RBAC per endpoint       │
                                     └─────────────┬────────────┘
                                                   │
                                                   ▼
                                     ┌──────────────────────────┐
                                     │  PostgreSQL (app)        │
                                     │  tasks, task_assignments │
                                     │  Volume: app-pgdata      │
                                     └──────────────────────────┘
```

Pełny diagram przepływu OAuth 2.0 Authorization Code + PKCE w pliku [docs/architecture.md](docs/architecture.md).

---

## 3. Stos technologiczny

| Komponent             | Technologia                                                              |
|-----------------------|--------------------------------------------------------------------------|
| Authorization Server  | Node.js 20 + Express + `oidc-provider` v8 (panva) + EJS                  |
| Resource Server (API) | Node.js 20 + Express + `jose` (walidacja JWT przez JWKS)                 |
| Frontend              | React 18 + Vite + `oidc-client-ts` (PKCE)                                |
| Bazy danych           | PostgreSQL 16 (osobne instancje dla auth i app, każda z wolumenem)       |
| Orkiestracja          | Docker Compose                                                           |
| Testy                 | Jest + Supertest                                                         |
| CI/CD                 | GitHub Actions (lint, test, build, docker build)                         |

---

## 4. Uruchomienie systemu

### Wymagania wstępne
- Docker Desktop 24+ z włączonym Docker Compose v2
- Wolne porty na hoscie: **3000** (frontend), **8088** (backend), **9000** (auth-server), **5440** (auth-db), **5441** (app-db). Wewnatrz sieci Dockerowej serwisy gadaja po standardowych portach (`5432`, `8080`, `9000`).

### Start (jedna komenda)

```bash
docker compose up --build
```

Po wstaniu kontenerów:

- Frontend:               http://localhost:3000
- Backend (API):          http://localhost:8088
- Authorization Server:   http://localhost:9000
- OIDC discovery:         http://localhost:9000/.well-known/openid-configuration
- JWKS:                   http://localhost:9000/jwks
- Healthcheck backendu:   http://localhost:8088/health (niezabezpieczony)

### Konta testowe (seedowane przy starcie auth-servera)

| Login   | Hasło      | Role          |
|---------|------------|---------------|
| `alice` | `password` | `user`        |
| `bob`   | `password` | `user`        |
| `admin` | `password` | `admin`, `user` |

### Scenariusz demo

1. Otwórz http://localhost:3000.
2. Kliknij **Zaloguj** -> SPA generuje `code_verifier` (kryptograficznie losowy, 43-128 B64URL znaków) i jego SHA-256 hash jako `code_challenge`, przekierowuje na `/authorize` Authorization Servera.
3. Zaloguj się jako `alice` / `password`.
4. Wyraź zgodę (consent) na zakres `openid profile email roles tasks.read tasks.write`.
5. Authorization Server odsyła `code` -> SPA wymienia go na `access_token` (JWT) na `/token`, dołączając wcześniej wygenerowany `code_verifier`.
6. SPA wywołuje `/api/tasks` z `Authorization: Bearer <jwt>`. Backend pobiera JWKS z `:9000/jwks`, weryfikuje podpis, sprawdza `aud`, `iss`, `exp` i scope. Wyświetlana jest lista zadań.
7. Zaloguj się jako `admin` -> zobaczysz dodatkowy widok administracyjny (`/api/admin/tasks`, `/api/admin/users`) chroniony rolą `admin`.

### Testy

```bash
# Testy jednostkowe / integracyjne (Jest + Supertest)
cd auth-server && npm install && npm test     # wymaga DATABASE_URL do testow integracyjnych
cd backend     && npm install && npm test     # wymaga DATABASE_URL do testow RBAC
```

### Skrypt weryfikacji end-to-end (symuluje przegladarke)

Po `docker compose up` mozna w pelni zweryfikowac flow PKCE bez przegladarki:

```bash
# Jako alice (rola user)
node scripts/verify-e2e.js

# Jako admin (rola admin + user) - dostaje 200 na /api/admin/users
LOGIN_USER=admin node scripts/verify-e2e.js
```

Skrypt sam generuje `code_verifier`/`code_challenge` (S256), przechodzi przez `/auth`,
`/interaction` (login + consent), wymienia kod na JWT, dekoduje go i wola backend
sprawdzajac RBAC. Jest to ten sam flow, ktory robi React SPA.

---

## 5. Endpointy backendu

| Metoda | Ścieżka                 | Auth | Wymagana rola | Wymagany scope          | Opis                              |
|--------|-------------------------|------|---------------|-------------------------|-----------------------------------|
| GET    | `/health`               | -    | -             | -                       | **Niezabezpieczony**. Liveness.   |
| GET    | `/ready`                | -    | -             | -                       | **Niezabezpieczony**. Readiness.  |
| GET    | `/api/profile`          | JWT  | (dowolna)     | `openid profile`        | Profil z tokenu (sub, claims).    |
| GET    | `/api/tasks`            | JWT  | (dowolna)     | `tasks.read`            | Lista zadań zalogowanego usera.   |
| POST   | `/api/tasks`            | JWT  | (dowolna)     | `tasks.write`           | Tworzenie zadania.                |
| PUT    | `/api/tasks/:id`        | JWT  | (dowolna)     | `tasks.write`           | Aktualizacja zadania (tylko swoje).|
| DELETE | `/api/tasks/:id`        | JWT  | (dowolna)     | `tasks.write`           | Usunięcie (swoje lub admin).      |
| GET    | `/api/admin/tasks`      | JWT  | **`admin`**   | `tasks.read`            | Wszystkie zadania (audyt).        |
| GET    | `/api/admin/users`      | JWT  | **`admin`**   | -                       | Lista użytkowników.               |
| POST   | `/api/admin/tasks/:id/assign` | JWT | **`admin`** | `tasks.write`        | Przypisanie zadania userowi.      |

Liczba endpointów: **2 niezabezpieczone + 8 zabezpieczonych (w tym 3 z RBAC)** - z naddatkiem spełnia wymóg minimum.

---

## 6. PKCE - jak działa (skrót)

PKCE (RFC 7636) to rozszerzenie OAuth 2.0 dla publicznych klientów (SPA, mobile) chroniące przed
przechwyceniem `authorization code`. Klient nie ma `client_secret`, więc samo przedstawienie kodu nie wystarcza
do udowodnienia, że to ten sam podmiot, który zainicjował logowanie.

1. Przed redirectem do `/authorize` klient generuje **`code_verifier`** - losowy ciąg 43-128 znaków URL-safe.
2. Liczy **`code_challenge = BASE64URL(SHA-256(code_verifier))`** i wysyła go w `/authorize`
   wraz z `code_challenge_method=S256`. Serwer zapisuje challenge.
3. Po loginie i consent serwer zwraca `code`. Sam kod jest jednorazowy, krótkożyjący i przypisany do tej sesji.
4. Klient wymienia `code` na token w `POST /token`, dołączając **oryginalny `code_verifier`**.
5. Serwer liczy `SHA-256(code_verifier)` i porównuje z zapisanym `code_challenge`. Jeśli się zgadza -> wydaje token.
   Jeśli atakujący przechwycił `code` (np. przez wyciek w log-history przeglądarki), nie zna `code_verifier`
   (nigdy nie opuścił JS-a klienta) i nie jest w stanie wymienić kodu na token.

W tym projekcie PKCE jest **wymuszone** - serwer odrzuca request bez `code_challenge` oraz akceptuje tylko `S256` (nie `plain`):
implementacja: [auth-server/src/config.js](auth-server/src/config.js).

---

## 7. Struktura repo

```
.
├── README.md                  - ten plik
├── docker-compose.yml         - orkiestracja całości
├── .github/workflows/ci.yml   - CI/CD pipeline
├── auth-server/               - Authorization Server (OIDC, PKCE)
│   ├── src/
│   │   ├── index.js           - bootstrap Express + oidc-provider
│   │   ├── config.js          - konfiguracja oidc-provider (PKCE, clients, scopes)
│   │   ├── account.js         - users, role lookup, hashowanie bcryptem
│   │   ├── routes.js          - login/consent interactions
│   │   └── views/             - EJS UI dla login/consent
│   ├── tests/                 - testy Jest
│   └── Dockerfile
├── backend/                   - Resource Server (REST API)
│   ├── src/
│   │   ├── index.js           - Express app
│   │   ├── auth.js            - middleware walidacji JWT przez JWKS + RBAC
│   │   ├── db.js              - pool PG
│   │   └── routes/            - tasks, admin, profile
│   ├── tests/
│   └── Dockerfile
├── frontend/                  - React SPA (Public Client)
│   ├── src/
│   │   ├── auth.js            - oidc-client-ts UserManager (PKCE)
│   │   ├── api.js             - wywołania backendu z Bearer JWT
│   │   ├── App.jsx
│   │   └── components/
│   └── Dockerfile
└── docs/
    └── architecture.md        - diagram + opis flowu
```

---

## 8. Licencja i autor

Projekt edukacyjny. Autor: **Adam Pietkiewicz**. Wszystkie biblioteki użyte zgodnie z ich licencjami (MIT/Apache 2.0).
