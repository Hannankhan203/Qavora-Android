# Qavora Android

Mobile-first QA management client built with **Expo (SDK 58)**, **React Native (0.88.1)**, and **React Native Web** in plain JavaScript (`.js`). Designed for `360dp–390dp` mobile viewports, offline resilience with queued synchronization, and cross-platform support across Android, iOS, and Web.

---

## Tech Stack

- **Runtime & Framework:** Expo `~58.0.23`, React `19.3.0`, React Native `0.88.1`, React Native Web `^0.21.4`
- **Package Manager:** Bun (`bun` + `bun.lock`)
- **Offline & Security:** `expo-secure-store` (`qavora.auth.cookie_jar.v1`), `@react-native-async-storage/async-storage`, `@react-native-community/netinfo`, `./plugins/withAndroidBackupProtection.js`
- **UI & Files:** `react-native-safe-area-context`, `expo-splash-screen`, `expo-status-bar`, `expo-document-picker`, `expo-file-system`, `expo-sharing`
- **Quality Tooling:** ESLint 9 (`@babel/eslint-parser`, `eslint-plugin-react`, `eslint-plugin-react-hooks`), Babel (`babel-preset-expo`), Bun Test (`bun test`)

---

## Prerequisites

- [Bun](https://bun.sh/) installed (`bun --version`)
- Node.js / Expo CLI environment compatible with Expo SDK 58
- Android Emulator / physical device (or iOS Simulator / modern web browser for Web target)
- Optional: EAS CLI (`bunx eas-cli`) and an Expo account for cloud builds

---

## Project Setup

1. Install dependencies strictly from `bun.lock`:

   ```bash
   bun install --frozen-lockfile
   ```

2. Copy `.env.example` to `.env` (or configure your shell/EAS environment) and fill in values appropriate for your target backend:

   ```bash
   cp .env.example .env
   ```

> **Note:** Use `bun` exclusively. Do not generate `package-lock.json`, `yarn.lock`, or `pnpm-lock.yaml`.

---

## Environment Variables

| Variable | Purpose | Notes |
| --- | --- | --- |
| `EXPO_PUBLIC_API_BASE_URL` | Primary backend API base URL | Read first by `src/services/apiClient.js`. Example for Android emulator local backend: `http://10.0.2.2:3000`. |
| `EXPO_PUBLIC_API_URL` | Fallback backend API base URL | Used only when `EXPO_PUBLIC_API_BASE_URL` is unset. |
| `EXPO_PUBLIC_TRUSTED_ORIGIN` | Explicit `Origin` header sent to backend CSRF/origin checks | Optional; defaults to the resolved `baseUrl` origin. Local origins are ignored if targeting an `https://` backend. |
| `EXPO_PUBLIC_APP_ORIGIN` | Fallback trusted origin variable | Read if `EXPO_PUBLIC_TRUSTED_ORIGIN` is unset. |
| `EXPO_PUBLIC_ALLOW_LOCAL_MOCK` | Opt-in (`true`) for the built-in in-memory local mock backend (`src/services/localMockBackend.js`) | Only takes effect in non-production dev when no backend URL is configured. Disabled (`"false"`) in `eas.json` profiles and release builds. |
| `EXPO_PUBLIC_ENV` | Explicit runtime environment indicator (`development`, `preview`, `production`) | Set automatically per EAS profile in `eas.json`. |

Never commit secrets or private credentials into `.env`, `app.json`, or `eas.json`.

---

## Local Development

- **Web dev server with local mock backend opt-in (port 3000):**

  ```bash
  bun run dev
  ```

- **Web dev server without local mock backend (uses configured `.env` API URL):**

  ```bash
  bun run start   # or: bun run web
  ```

- **Android / iOS Metro bundler:**

  ```bash
  bun run android
  bun run ios
  ```

---

## Testing, Linting & Security Audits

- **Run all automated Bun tests:**

  ```bash
  bun test --timeout 15000
  ```

  Additional test scripts: `bun run test:watch` and `bun run test:coverage`.

- **Lint & JS/JSX syntax check:**

  ```bash
  bun run lint
  ```

  Runs `eslint .` (`eslint.config.js`) and parses all 67 application `.js` files with `babel-preset-expo`.

- **Dependency vulnerability audit:**

  ```bash
  bun run audit
  ```

- **Expo diagnostics & public config check:**

  ```bash
  bunx expo-doctor
  bunx expo config --type public --json
  ```

---

## Architecture & Directory Layout

- `index.js` / `App.js`: Entry point, provider tree (`ThemeProvider` -> `AuthProvider` -> `ProjectProvider` -> `WorkspaceProvider`), shell navigation (drawer, 5-tab bar, Android `BackHandler`), and root safe-area layout.
- `src/components/`: Feature screens (`AuthScreen`, `ProjectSelectionScreen`, `ProjectDetailsScreen`, `DashboardScreen`, `TestCasesScreen`, `TestRunsScreen`, `DefectsScreen`, `ChecklistsScreen`, `ReportsView`, `ProfileSettingsScreen`, `DataManagementSection`, `ProjectFormModal`) and modular subdirectories (`checklists/`, `defects/`, `testCases/`, `testRuns/`).
- `src/context/`: Auth, Project, and Workspace state management (`src/context/workspace/` helpers).
- `src/services/`: Cookie-jar auth (`expo-secure-store` native / DOM cookies web), CSRF-protected HTTP client (`apiClient.js`), offline mutation queue & conflict resolution (`offlineSyncService.js` + `offlineSync/`), checklists (`checklists/`), project persistence, data import/export, and reporting.
- `plugins/withAndroidBackupProtection.js`: Continuous Native Generation (CNG) config plugin setting `android:allowBackup="false"`, `android:fullBackupContent="@xml/qavora_backup_rules"`, and `android:dataExtractionRules="@xml/qavora_data_extraction_rules"`. Do not commit generated `/android` or `/ios` directories.

---

## Builds & Deployment

### Production Web Export

Export the static web bundle to `dist/`:

```bash
bun run build
```

### Android Builds via EAS (`eas.json`)

The repository uses Expo Application Services (EAS) and Continuous Native Generation (CNG). Do not pre-generate and commit `/android` or `/ios`.

| Profile | Distribution | Android Build Type | Environment (`eas.json`) |
| --- | --- | --- | --- |
| `development` | `internal` | `apk` (`developmentClient: true`) | `EXPO_PUBLIC_ENV=development`, targets `http://10.0.2.2:3000`, mock backend disabled |
| `preview` | `internal` | `apk` | `EXPO_PUBLIC_ENV=preview`, mock backend disabled; supply preview API URL via EAS env vars (isolated from production API) |
| `production` | `store` | `app-bundle` (AAB) | `EXPO_PUBLIC_ENV=production`, targets `https://qavora-mongo-db-integrated.vercel.app`, mock backend disabled |

Run an EAS build using the desired profile:

```bash
bunx eas-cli build --platform android --profile development
bunx eas-cli build --platform android --profile preview
bunx eas-cli build --platform android --profile production
```

For `preview` builds targeting a staging/preview backend, configure `EXPO_PUBLIC_API_BASE_URL` and `EXPO_PUBLIC_TRUSTED_ORIGIN` in your EAS environment or build environment variables before running the preview build.
