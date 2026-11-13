# Qavora Android — Agent & Developer Guide

This is **Qavora Android**, a mobile-first **Expo (SDK 58) / React Native (0.88.1) + React Native Web** QA management client written in **plain JavaScript (`.js`)**. Prioritize mobile-first responsiveness (`360dp–390dp`), offline resilience, and cross-platform compatibility across Android, iOS, and Web.

> **Important:** Inspect `package.json`, `app.json`, and `https://docs.expo.dev/versions/v58.0.0/` (or `https://docs.expo.dev/llms.txt`) before introducing or modifying Expo or React Native APIs.

## Package Manager & Lockfile

- **Authoritative Package Manager:** **Bun** (`bun` + `bun.lock`).
- Do **not** generate conflicting lockfiles (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`).
- Do **not** hand-edit `bun.lock`.

## Commands

```bash
bun install                            # install dependencies matching bun.lock
bun install --frozen-lockfile          # verify/install strictly from bun.lock
bunx expo install <package>            # install SDK-58-compatible Expo/RN packages
bun run dev                            # start Expo Web dev server on port 3000 with local mock backend opt-in
bun run start                          # start Expo Web dev server on port 3000 (no mock opt-in; alias: web)
bun run android                        # start Expo Metro bundler for Android
bun run ios                            # start Expo Metro bundler for iOS
bun run build                          # export production web bundle (expo export --platform web)
bun run lint                           # run ESLint 9 (@babel/eslint-parser) + Babel parse check across 67 app JS/JSX files
bun test --timeout 15000               # run Bun automated test suite (alias: bun run test, test:watch, test:coverage)
bun run audit                          # check installed dependencies for vulnerabilities via bun audit
bunx expo config --type public --json   # inspect resolved public Expo configuration
bunx expo-doctor                       # diagnose Expo dependency and app.json schema issues
bunx eas-cli <command>                 # run EAS cloud builds/updates (eas.json)
```

> Note: The repository uses plain JavaScript (`.js`) validated with **ESLint 9** (`eslint.config.js` using `@babel/eslint-parser` + `eslint-plugin-react` + `eslint-plugin-react-hooks`) and Babel (`babel-preset-expo`) syntax parsing across `index.js`, `App.js`, and `src/**/*.js`, plus **Bun Test** (`tests/*.test.js`). TypeScript (`tsc`) and Expo Router are not used. Do not add `eslint-disable` comments in `/App.js` or `/src/`.

## Entry Point, Navigation & Folder Structure

- **Entry Point:** `/index.js` registers `/App.js` via Expo's `registerRootComponent(App)`.
- **Navigation Architecture:** State- and Context-driven navigation inside `/App.js` (`QavoraQAShell`) backed by `/src/context/WorkspaceContext.js` (not Expo Router). Navigation combines:
  - Root auth gate (`AuthScreen` when unauthenticated; `ProjectProvider` -> `WorkspaceProvider` -> `QavoraQAShell` when authenticated)
  - Slide-out global drawer (`NAVIGATION_DESTINATIONS` across 11 destinations)
  - Bottom 5-tab bar (`dashboard`, `testcases`, `testruns`, `defects`, `profile`)
  - Nested sub-view states (`projectViewMode`, `dashboardSubTab`, `testCasesSubTab`, `testRunsViewMode`, `profileSubView`) and Android `BackHandler` / safe-area integration (`react-native-safe-area-context`)
- **Project Structure:**
  - `/index.js` & `/App.js` — App root registration, provider hierarchy, shell UI, drawer, bottom tabs, back handler
  - `/src/context/` — `AuthContext.js`, `ProjectContext.js`, `WorkspaceContext.js`, and `/src/context/workspace/` (`defectIdUtils.js`, `workspaceConstants.js`, `workspacePayloads.js`)
  - `/src/components/` — Top-level screens (`AuthScreen.js`, `ProjectSelectionScreen.js`, `ProjectDetailsScreen.js`, `ProjectFormModal.js`, `DashboardScreen.js`, `TestCasesScreen.js`, `TestRunsScreen.js`, `DefectsScreen.js`, `ChecklistsScreen.js`, `ReportsView.js`, `ProfileSettingsScreen.js`, `DataManagementSection.js`, `VectorIcon.js`) plus modular modals & stylesheets in `checklists/`, `defects/`, `testCases/`, and `testRuns/`
  - `/src/services/` — HTTP transport, secure cookies, auth, projects, checklists, offline sync, data backup/recovery, reports, and dev-only local mock (`apiClient.js`, `cookieManager.js`, `authService.js`, `projectService.js`, `checklistService.js`, `offlineSyncService.js`, `dataManagementService.js`, `reportService.js`, `localMockBackend.js`) plus modular helpers in `checklists/` and `offlineSync/`
  - `/src/theme/theme.js` — Light/dark color palettes and typography constants
  - `/src/data/initialData.js` — Sample QA dataset and domain constants
  - `/plugins/withAndroidBackupProtection.js` — Expo CNG config plugin enforcing `android:allowBackup="false"`, `@xml/qavora_backup_rules`, and `@xml/qavora_data_extraction_rules`
  - `/tests/` — Bun test suites (`androidBackupProtection.test.js`, `authAndSecurity.test.js`, `dataIntegrity.test.js`, `medPhase5Regression.test.js`, `lowPhase6Regression.test.js`, `reportsAndDates.test.js`, `uiAndDomainRegression.test.js`, and `helpers/testEnv.js`)
  - `/assets/` — App icons (`qavora-icon-512.png`), Android adaptive icon layers, and web favicon (`favicon.png`)
  - `/app.json`, `/eas.json`, `/eslint.config.js`, `/.env.example`, `/package.json`, `/bun.lock` — Expo, EAS, ESLint, env, and dependency config

## Preserved Security & Native Rules

- **Native Auth & Cookie Storage:** Keep authentication and CSRF cookies in `expo-secure-store` (`qavora.auth.cookie_jar.v1` with `SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`), never plaintext `AsyncStorage`. Keep `credentials: 'omit'` on native React Native requests vs `credentials: 'include'` on Web DOM (`apiClient.js`).
- **HTTPS & Input Validation:** Preserve HTTPS enforcement for production / `__Host-` cookies, sensitive diagnostic redaction (`authService.js`), user-scoped `AsyncStorage` prefixes, and NoSQL `$`/dotted-key/prototype-pollution validation (`projectService.js`, `dataManagementService.js`).
- **Continuous Native Generation (CNG):** Do not create or manually edit `/ios` or `/android` native directories; configure native behavior in `app.json` and `./plugins/withAndroidBackupProtection.js`.
- **EAS Cloud Builds:** `eas.json` defines three isolated Android profiles: `development` (development client APK pointing to `http://10.0.2.2:3000`), `preview` (internal APK isolated from production API), and `production` (store app-bundle targeting `https://qavora-mongo-db-integrated.vercel.app`), all with `EXPO_PUBLIC_ALLOW_LOCAL_MOCK: "false"`.

