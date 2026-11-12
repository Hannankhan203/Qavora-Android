# Qavora Android — Agent & Developer Guide

This is **Qavora Android**, a mobile-first **Expo (SDK 58) / React Native (0.88.1) + React Native Web** QA management client written in **plain JavaScript (`.js`)**. Prioritize mobile-first responsiveness (`360dp–390dp`), offline resilience, and cross-platform compatibility across Android, iOS, and Web.

> **Important:** Inspect `package.json`, `app.json`, and `https://docs.expo.dev/versions/v58.0.0/` (or `https://docs.expo.dev/llms.txt`) before introducing or modifying Expo or React Native APIs.

## Package Manager & Lockfile

- **Authoritative Package Manager:** **Bun** (`bun` + `bun.lock`).
- Do **not** generate conflicting lockfiles (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`).
- Do **not** hand-edit `bun.lock`.

## Commands

```bash
bun install                          # install dependencies matching bun.lock
bun install --frozen-lockfile        # verify/install strictly from bun.lock
bunx expo install <package>          # install SDK-58-compatible Expo/RN packages
bun run dev                          # start Expo Web dev server on port 3000 (alias: start, web)
bun run android                      # start Expo Metro bundler for Android
bun run ios                          # start Expo Metro bundler for iOS
bun run build                        # export production web bundle (expo export --platform web)
bun run lint                         # syntax-check all 28 .js source files via node --check
bun audit                            # check installed dependencies for vulnerabilities (alias: bun run audit)
bunx expo config --type public --json # inspect resolved public Expo configuration
bunx expo-doctor                     # diagnose Expo dependency and app.json schema issues
bunx eas-cli <command>               # run EAS cloud builds/updates (eas.json)
```

> Note: The repository uses plain JavaScript (`.js`) with `node --check` syntax validation; TypeScript (`tsc`), ESLint, Expo Router, and automated test suites are **not** currently configured.

## Entry Point, Navigation & Folder Structure

- **Entry Point:** `/index.js` registers `/App.js` via Expo's `registerRootComponent(App)`.
- **Navigation Architecture:** State- and Context-driven navigation inside `/App.js` (`QavoraQAShell`) backed by `/src/context/WorkspaceContext.js` (not Expo Router). Navigation combines:
  - Root auth gate (`AuthScreen` when unauthenticated; `ProjectProvider` -> `WorkspaceProvider` -> `QavoraQAShell` when authenticated)
  - Slide-out global drawer (`NAVIGATION_DESTINATIONS` across 11 destinations)
  - Bottom 5-tab bar (`dashboard`, `testcases`, `testruns`, `defects`, `profile`)
  - Nested sub-view states (`projectViewMode`, `dashboardSubTab`, `testCasesSubTab`, `testRunsViewMode`, `profileSubView`) and Android `BackHandler` integration
- **Project Structure:**
  - `/index.js` & `/App.js` — App root registration, provider hierarchy, shell UI, drawer, bottom tabs, back handler
  - `/src/context/` — `AuthContext.js`, `ProjectContext.js`, `WorkspaceContext.js`
  - `/src/components/` — Screens, modals, and UI icons (`AuthScreen.js`, `ProjectSelectionScreen.js`, `ProjectDetailsScreen.js`, `ProjectFormModal.js`, `DashboardScreen.js`, `TestCasesScreen.js`, `TestRunsScreen.js`, `DefectsScreen.js`, `ChecklistsScreen.js`, `ReportsView.js`, `ProfileSettingsScreen.js`, `DataManagementSection.js`, `VectorIcon.js`)
  - `/src/services/` — HTTP transport, secure cookies, auth, projects, checklists, offline sync, data backup/recovery, and reports (`apiClient.js`, `cookieManager.js`, `authService.js`, `projectService.js`, `checklistService.js`, `offlineSyncService.js`, `dataManagementService.js`, `reportService.js`)
  - `/src/theme/theme.js` — Light/dark color palettes and typography constants
  - `/src/data/initialData.js` — Sample QA dataset and domain constants
  - `/assets/` — App icons, Android adaptive icon layers, and web favicon
  - `/app.json`, `/eas.json`, `/.env.example`, `/package.json`, `/bun.lock` — Expo, EAS, env, and dependency config

## Preserved Security & Native Rules

- **Native Auth & Cookie Storage:** Keep authentication and CSRF cookies in `expo-secure-store` (`qavora.auth.cookie_jar.v1` with `SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`), never plaintext `AsyncStorage`. Keep `credentials: 'omit'` on native React Native requests vs `credentials: 'include'` on Web DOM (`apiClient.js`).
- **HTTPS & Input Validation:** Preserve HTTPS enforcement for production / `__Host-` cookies, sensitive diagnostic redaction (`authService.js`), user-scoped `AsyncStorage` prefixes, and NoSQL `$`/dotted-key/prototype-pollution validation (`projectService.js`, `dataManagementService.js`).
- **Continuous Native Generation (CNG):** Do not create or manually edit `/ios` or `/android` native directories; configure native behavior in `app.json` and config plugins.
- **EAS Cloud Builds:** `eas.json` defines `preview` and `production` Android APK profiles with `EXPO_PUBLIC_API_BASE_URL` and `EXPO_PUBLIC_TRUSTED_ORIGIN`.

