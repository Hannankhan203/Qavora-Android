import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  memoryAsyncStorage,
  secureStoreController,
  mockSecureStoreModule,
  safeAreaInsetsController,
  createRenderHarness,
  findElements,
} from './helpers/testEnv.js';

const React = await import('react');
const { ThemeProvider, lightColors } = await import('../src/theme/theme.js');
const { setAuthUserStorageAdapter } = await import('../src/services/authService.js');
const { AuthProvider } = await import('../src/context/AuthContext.js');
const { ProjectProvider, useProjects, setProjectStorageAdapter } = await import(
  '../src/context/ProjectContext.js'
);
const { WorkspaceProvider, setWorkspaceStorageAdapter } = await (async () => {
  const mod = await import('../src/context/WorkspaceContext.js');
  return { WorkspaceProvider: mod.WorkspaceProvider, setWorkspaceStorageAdapter: null };
})();
const { setDataManagementStorageAdapter } = await import(
  '../src/services/dataManagementService.js'
);
const { setDefectIdStorageAdapter } = await import(
  '../src/context/workspace/defectIdUtils.js'
);
const { setOfflineSyncStorageAdapter, setSimulatedOfflineMode, setActiveSyncUser } =
  await import('../src/services/offlineSyncService.js');
const { setChecklistStorageAdapter } = await import('../src/services/checklistService.js');
const { clearAllCookies, setCookieStorageAdapter, setSecureStoreImplementation } =
  await import('../src/services/cookieManager.js');

const checklistsStyles = (await import('../src/components/checklists/checklistsStyles.js'))
  .default;
const defectsStyles = (await import('../src/components/defects/defectsStyles.js')).default;
const testCasesStyles = (await import('../src/components/testCases/testCasesStyles.js'))
  .default;
const testRunsStyles = (await import('../src/components/testRuns/testRunsStyles.js'))
  .default;

const DefectDetailModal = (await import('../src/components/defects/DefectDetailModal.js'))
  .default;
const ChecklistFormModal = (
  await import('../src/components/checklists/ChecklistFormModal.js')
).default;
const TestRunExecutionModal = (
  await import('../src/components/testRuns/TestRunExecutionModal.js')
).default;
const ChecklistsScreen = (await import('../src/components/ChecklistsScreen.js')).default;
const TestCasesScreen = (await import('../src/components/TestCasesScreen.js')).default;

const PROJECT_ROOT = path.resolve(import.meta.dir, '..');

function walkFiles(dir, extensions = ['.js']) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === 'node_modules' ||
      entry.name === '.expo' ||
      entry.name === 'dist' ||
      entry.name === 'android' ||
      entry.name === 'ios'
    ) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full, extensions));
    } else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
      results.push(full);
    }
  }
  return results;
}

function compareSemver(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

describe('Phase 6 — LOW Issues Remediation (LOW-01..LOW-04)', () => {
  const prevEnv = {
    EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
    EXPO_PUBLIC_TRUSTED_ORIGIN: process.env.EXPO_PUBLIC_TRUSTED_ORIGIN,
    EXPO_PUBLIC_ALLOW_LOCAL_MOCK: process.env.EXPO_PUBLIC_ALLOW_LOCAL_MOCK,
    EXPO_PUBLIC_ENV: process.env.EXPO_PUBLIC_ENV,
    NODE_ENV: process.env.NODE_ENV,
  };
  let origFetch;
  let harness;

  beforeEach(async () => {
    origFetch = globalThis.fetch;
    await memoryAsyncStorage.clear();
    secureStoreController.reset();
    safeAreaInsetsController.reset();

    setAuthUserStorageAdapter(memoryAsyncStorage);
    setProjectStorageAdapter(memoryAsyncStorage);
    setDataManagementStorageAdapter(memoryAsyncStorage);
    setDefectIdStorageAdapter(memoryAsyncStorage);
    setOfflineSyncStorageAdapter(memoryAsyncStorage);
    setChecklistStorageAdapter(memoryAsyncStorage);
    setCookieStorageAdapter(memoryAsyncStorage);
    if (typeof setWorkspaceStorageAdapter === 'function') {
      setWorkspaceStorageAdapter(memoryAsyncStorage);
    }
    await clearAllCookies();
    setSecureStoreImplementation(mockSecureStoreModule);
    setActiveSyncUser(null);
    setSimulatedOfflineMode(false, { skipAutoReconnect: true });

    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://qavora.example.test';
    process.env.EXPO_PUBLIC_API_URL = 'https://qavora.example.test';
    process.env.EXPO_PUBLIC_TRUSTED_ORIGIN = 'https://qavora.example.test';
    delete process.env.EXPO_PUBLIC_ALLOW_LOCAL_MOCK;
    delete process.env.EXPO_PUBLIC_ENV;
    process.env.NODE_ENV = 'test';

    harness = await createRenderHarness();
  });

  afterEach(async () => {
    await harness.cleanup();
    globalThis.fetch = origFetch;
    safeAreaInsetsController.reset();
    setSimulatedOfflineMode(false, { skipAutoReconnect: true });
    setActiveSyncUser(null);
    await memoryAsyncStorage.clear();
    await clearAllCookies();
    Object.entries(prevEnv).forEach(([key, val]) => {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    });
  });

  // =========================================================================
  // LOW-01 — Touch Targets & Safe Areas
  // =========================================================================
  it('LOW-01: enforces >= 44dp primary/footer touch targets and >= 36dp scroll bottom padding across feature stylesheets', () => {
    const mustBe44 = [
      [checklistsStyles, ['primaryHeaderBtn', 'secondaryHeaderBtn', 'scopeTab', 'retryBtn', 'templateQuickBtn', 'backBtn', 'smallActionBtn', 'secondaryBtn', 'addItemSubmitBtn', 'modalCancelBtn', 'modalConfirmBtn', 'searchBox', 'addItemInput', 'input']],
      [defectsStyles, ['primaryActionBtn', 'kpiChip', 'searchBox', 'logBugBtn', 'deleteModalBtn', 'cancelBtn', 'saveBtn', 'confirmCancelBtn', 'confirmDeleteBtn']],
      [testCasesStyles, ['errorBannerBtn', 'errorBannerBtnOutline', 'searchInputBox', 'addCaseBtn', 'emptyCta', 'primaryActionBtn', 'secondaryActionBtn', 'footerDangerBtn', 'footerSecondaryBtn', 'footerPrimaryBtn', 'suiteSelectItem']],
      [testRunsStyles, ['primaryActionBtn', 'completeRunBtn', 'secondaryRunBtn', 'counterChip', 'searchBox', 'outcomeBtn', 'failAndBugBtn', 'casePickerRow', 'cancelBtn', 'saveBtn', 'confirmCancelBtn', 'confirmDeleteBtn']],
    ];

    for (const [sheet, keys] of mustBe44) {
      for (const key of keys) {
        const rule = sheet[key];
        expect(rule).toBeTruthy();
        const effectiveMinH = Math.max(rule.minHeight || 0, rule.height || 0);
        expect(effectiveMinH).toBeGreaterThanOrEqual(44);
      }
    }

    expect(checklistsStyles.content.paddingBottom).toBeGreaterThanOrEqual(36);
    expect(defectsStyles.contentContainer.paddingBottom).toBeGreaterThanOrEqual(36);
    expect(testCasesStyles.listContent.paddingBottom).toBeGreaterThanOrEqual(36);
    expect(testRunsStyles.contentContainer.paddingBottom).toBeGreaterThanOrEqual(36);

    const appJson = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'app.json'), 'utf8'));
    expect(appJson.expo.android.softwareKeyboardLayoutMode).toBe('resize');
  });

  it('LOW-01: integrates useSafeAreaInsets in all modal screens and applies runtime edge-to-edge top/bottom insets and hitSlop', async () => {
    const componentFiles = walkFiles(path.join(PROJECT_ROOT, 'src', 'components'), ['.js']);
    const filesWithModal = componentFiles.filter((filePath) =>
      fs.readFileSync(filePath, 'utf8').includes('<Modal')
    );
    expect(filesWithModal.length).toBeGreaterThanOrEqual(15);
    for (const filePath of filesWithModal) {
      const code = fs.readFileSync(filePath, 'utf8');
      expect(code).toContain("from 'react-native-safe-area-context'");
      expect(code).toContain('useSafeAreaInsets()');
    }

    safeAreaInsetsController.set({ top: 48, bottom: 34, left: 0, right: 0 });

    // 1. DefectDetailModal applies insets.top (48) on overlay and insets.bottom + 8 (42) on footer
    await harness.render(
      React.createElement(DefectDetailModal, {
        theme: lightColors,
        viewingDefect: {
          id: 'DEF-601',
          defectId: 'DEF-601',
          title: 'Safe area footer overlap bug',
          severity: 'Medium',
          priority: 'High',
          status: 'Open',
          reproductionSteps: '1. Open detail modal',
          expectedResult: 'Footer clears system nav bar',
          actualResult: 'Padded cleanly',
        },
        closeDetailModal: () => {},
        getSeverityBadge: () => ({ bg: '#FEE2E2', color: '#B91C1C' }),
        getPriorityBadge: () => ({ bg: '#FEF3C7', color: '#B45309' }),
        getStatusBadge: () => ({ bg: '#DBEAFE', color: '#1D4ED8' }),
        isUpdatingStatus: false,
        handleQuickStatusChange: () => {},
        handleOpenExternalUrl: () => {},
        testCases: [],
        testRuns: [],
        setSelectedTestCaseId: () => {},
        setSelectedTestRunId: () => {},
        setActiveTab: () => {},
        onRequestDeleteDefect: () => {},
        openEditDefectForm: () => {},
      })
    );
    await harness.flush(20);

    const detailOverlay = findElements(
      harness.container,
      (el) => el.getAttribute && el.getAttribute('data-padding-top') === '48'
    );
    const detailFooter = findElements(
      harness.container,
      (el) => el.getAttribute && el.getAttribute('data-padding-bottom') === '42'
    );
    expect(detailOverlay.length).toBeGreaterThanOrEqual(1);
    expect(detailFooter.length).toBeGreaterThanOrEqual(1);

    // 2. ChecklistFormModal propagates both paddingTop (48) and paddingBottom (42) under insets
    await harness.render(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(ChecklistFormModal, {
          formModalVisible: true,
          setFormModalVisible: () => {},
          formMode: 'create',
          checklistFormScrollRef: { current: null },
          formError: '',
          formTemplateId: '',
          handleSelectStarterTemplate: () => {},
          formTitleRef: { current: null },
          formTitle: '',
          setFormTitle: () => {},
          scrollChecklistFormTo: () => {},
          formDescRef: { current: null },
          formDescription: '',
          setFormDescription: () => {},
          formCategory: 'General QA',
          setFormCategory: () => {},
          formPriority: 'High',
          setFormPriority: () => {},
          selectedProjectId: null,
          selectedProject: null,
          formProjectScope: 'global',
          setFormProjectScope: () => {},
          formEnvRef: { current: null },
          formEnvironment: '',
          setFormEnvironment: () => {},
          formReleaseRef: { current: null },
          formTargetRelease: '',
          setFormTargetRelease: () => {},
          formCustomItemsRef: { current: null },
          formCustomItemsText: '',
          setFormCustomItemsText: () => {},
          handleSaveChecklistForm: () => {},
          busyMutation: false,
        })
      )
    );
    await harness.flush(20);
    expect(
      findElements(
        harness.container,
        (el) =>
          el.getAttribute &&
          el.getAttribute('data-padding-top') === '48' &&
          el.getAttribute('data-padding-bottom') === '42'
      ).length
    ).toBeGreaterThanOrEqual(1);

    // 3. TestRunExecutionModal applies paddingTop (48) and runnerFooter paddingBottom (42)
    await harness.render(
      React.createElement(TestRunExecutionModal, {
        theme: lightColors,
        executingCase: {
          testCaseId: 'TC-1',
          title: 'Verify gesture nav clearance',
          preconditions: '',
          steps: [],
          expectedResult: 'Buttons clear nav bar',
        },
        setExecutingCaseId: () => {},
        activeRun: { id: 'run-1', name: 'Safe Area Run' },
        execRunnerScrollRef: { current: null },
        execActualResultRef: { current: null },
        execNotesRef: { current: null },
        execTesterRef: { current: null },
        execEnvironmentRef: { current: null },
        execDeviceRef: { current: null },
        execBuildVersionRef: { current: null },
        scrollRunModalTo: () => {},
        stepStatuses: [],
        markAllStepsPassed: () => {},
        toggleStepStatus: () => {},
        execActualResult: '',
        setExecActualResult: () => {},
        execNotes: '',
        setExecNotes: () => {},
        execTester: 'QA',
        setExecTester: () => {},
        execEnvironment: 'Android 15',
        setExecEnvironment: () => {},
        execDevice: 'Pixel 9',
        setExecDevice: () => {},
        execBuildVersion: '1.0.0',
        setExecBuildVersion: () => {},
        isSubmittingExec: false,
        handleSaveExecution: () => {},
      })
    );
    await harness.flush(20);
    expect(
      findElements(
        harness.container,
        (el) => el.getAttribute && el.getAttribute('data-padding-top') === '48'
      ).length
    ).toBeGreaterThanOrEqual(1);
    expect(
      findElements(
        harness.container,
        (el) => el.getAttribute && el.getAttribute('data-padding-bottom') === '42'
      ).length
    ).toBeGreaterThanOrEqual(1);

    // 4. Compact interactive chips/buttons render explicit hitSlop on ChecklistsScreen & TestCasesScreen
    const tc1 = {
      id: 'TC-601',
      testCaseId: 'TC-601',
      suiteId: 's1',
      suiteName: 'Core',
      title: 'Compact action button hitSlop check',
      priority: 'P1',
      lastStatus: 'Untested',
    };
    const serverProject = {
      id: 'proj-low1',
      name: 'Touch Target App',
      updatedAt: '2026-08-01T00:00:00.000Z',
      testSuites: [{ id: 's1', name: 'Core', cases: [tc1], testCases: [tc1] }],
      executionRuns: [],
      executions: [],
      defects: [],
      testPlan: { id: 'p1', name: 'Plan', phases: [] },
    };
    const chk = {
      id: 'chk-low1',
      userId: 'u-low-1',
      title: 'Release Signoff',
      category: 'General QA',
      priority: 'High',
      status: 'In Progress',
      items: [{ id: 'i1', title: 'Check touch targets', priority: 'High', completed: false }],
    };

    globalThis.fetch = async (url) => {
      const target = String(url);
      if (target.endsWith('/api/auth/me')) {
        return new Response(
          JSON.stringify({
            user: { userId: 'u-low-1', email: 'low1@qavora.example.test', name: 'QA' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (target.endsWith('/api/projects')) {
        return new Response(JSON.stringify([serverProject]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (target.endsWith(`/api/projects/${serverProject.id}`)) {
        return new Response(JSON.stringify({ project: serverProject }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (target.endsWith('/api/checklists')) {
        return new Response(JSON.stringify({ checklists: [chk] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    let projRef = null;
    function CasesHarness() {
      projRef = useProjects();
      return React.createElement(TestCasesScreen);
    }

    await harness.render(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(
          AuthProvider,
          null,
          React.createElement(
            ProjectProvider,
            null,
            React.createElement(WorkspaceProvider, null, React.createElement(CasesHarness))
          )
        )
      )
    );
    await harness.flush(50);
    await React.act(async () => {
      await projRef.selectProject('proj-low1');
    });
    await harness.flush(30);

    const hitSlopNodes = findElements(
      harness.container,
      (el) => el.getAttribute && el.getAttribute('data-hit-slop') !== null
    );
    expect(hitSlopNodes.length).toBeGreaterThanOrEqual(4);

    await harness.render(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(
          AuthProvider,
          null,
          React.createElement(
            ProjectProvider,
            null,
            React.createElement(
              WorkspaceProvider,
              null,
              React.createElement(ChecklistsScreen, { activeChecklistId: 'chk-low1' })
            )
          )
        )
      )
    );
    await harness.flush(50);

    const chkHitSlopNodes = findElements(
      harness.container,
      (el) => el.getAttribute && el.getAttribute('data-hit-slop') !== null
    );
    expect(chkHitSlopNodes.length).toBeGreaterThanOrEqual(4);
  });

  // =========================================================================
  // LOW-02 — Project Cleanup & Documentation
  // =========================================================================
  it('LOW-02: preserves official Qavora brand assets, integrates web favicon/PWA/touch icons, fixes package.json audit script, updates AGENTS.md, and provides accurate README.md', () => {
    const requiredAssets = [
      'qavora-icon.ico',
      'qavora-icon-512.png',
      'icon-192.png',
      'apple-touch-icon.png',
      'android-icon-foreground.png',
      'android-icon-background.png',
      'android-icon-monochrome.png',
    ];
    for (const assetName of requiredAssets) {
      expect(fs.existsSync(path.join(PROJECT_ROOT, 'assets', assetName))).toBe(true);
    }

    const publicIndexHtml = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'index.html'), 'utf8');
    expect(publicIndexHtml).toContain('href="/favicon.ico"');
    expect(publicIndexHtml).toContain('href="/apple-touch-icon.png"');
    expect(publicIndexHtml).toContain('href="/icon-192.png"');
    expect(publicIndexHtml).toContain('href="/qavora-icon-512.png"');
    expect(publicIndexHtml).toContain('href="/manifest.json"');

    const publicManifest = JSON.parse(
      fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'manifest.json'), 'utf8')
    );
    expect(publicManifest.icons.map((icon) => icon.src)).toEqual([
      '/icon-192.png',
      '/qavora-icon-512.png',
    ]);

    const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts.audit).toBe('bun audit');
    expect(pkg.scripts.lint).toContain('eslint .');

    const agentsMd = fs.readFileSync(path.join(PROJECT_ROOT, 'AGENTS.md'), 'utf8');
    expect(agentsMd).toContain('ESLint 9');
    expect(agentsMd).toContain('bun test');
    expect(agentsMd).toContain('bun run audit');
    expect(agentsMd).toContain('withAndroidBackupProtection.js');
    expect(agentsMd).not.toContain('all 28 .js');
    expect(agentsMd).not.toContain('ESLint, Expo Router, and automated test suites are **not**');

    const readmeMd = fs.readFileSync(path.join(PROJECT_ROOT, 'README.md'), 'utf8');
    expect(readmeMd).toContain('bun install --frozen-lockfile');
    expect(readmeMd).toContain('EXPO_PUBLIC_API_BASE_URL');
    expect(readmeMd).toContain('EXPO_PUBLIC_TRUSTED_ORIGIN');
    expect(readmeMd).toContain('EXPO_PUBLIC_ALLOW_LOCAL_MOCK');
    expect(readmeMd).toContain('bun test --timeout 15000');
    expect(readmeMd).toContain('bun run audit');
    expect(readmeMd).toContain('bun run build');
    expect(readmeMd).toContain('development');
    expect(readmeMd).toContain('preview');
    expect(readmeMd).toContain('production');
  });

  // =========================================================================
  // LOW-03 — EAS Build Profiles
  // =========================================================================
  it('LOW-03: configures isolated development, preview, and production EAS build profiles with local mock disabled and no secrets', () => {
    const easRaw = fs.readFileSync(path.join(PROJECT_ROOT, 'eas.json'), 'utf8');
    const eas = JSON.parse(easRaw);
    const { development, preview, production } = eas.build;

    expect(development).toBeTruthy();
    expect(development.developmentClient).toBe(true);
    expect(development.distribution).toBe('internal');
    expect(development.android?.buildType).toBe('apk');
    expect(development.env.EXPO_PUBLIC_ENV).toBe('development');
    expect(development.env.EXPO_PUBLIC_API_BASE_URL).toBe('http://10.0.2.2:3000');
    expect(development.env.EXPO_PUBLIC_TRUSTED_ORIGIN).toBe('http://10.0.2.2:3000');
    expect(development.env.EXPO_PUBLIC_ALLOW_LOCAL_MOCK).toBe('false');

    expect(preview).toBeTruthy();
    expect(preview.distribution).toBe('internal');
    expect(preview.android?.buildType).toBe('apk');
    expect(preview.env.EXPO_PUBLIC_ENV).toBe('preview');
    expect(preview.env.EXPO_PUBLIC_API_BASE_URL).toBe(
      'https://qavora-mongo-db-integrated.vercel.app'
    );
    expect(preview.env.EXPO_PUBLIC_TRUSTED_ORIGIN).toBe(
      'https://qavora-mongo-db-integrated.vercel.app'
    );
    expect(preview.env.EXPO_PUBLIC_ALLOW_LOCAL_MOCK).toBe('false');

    expect(production).toBeTruthy();
    expect(production.distribution).toBe('store');
    expect(production.android?.buildType).toBe('app-bundle');
    expect(production.env.EXPO_PUBLIC_ENV).toBe('production');
    expect(production.env.EXPO_PUBLIC_API_BASE_URL).toBe(
      'https://qavora-mongo-db-integrated.vercel.app'
    );
    expect(production.env.EXPO_PUBLIC_TRUSTED_ORIGIN).toBe(
      'https://qavora-mongo-db-integrated.vercel.app'
    );
    expect(production.env.EXPO_PUBLIC_ALLOW_LOCAL_MOCK).toBe('false');
    expect(preview.env.EXPO_PUBLIC_ENV).not.toBe(production.env.EXPO_PUBLIC_ENV);
    expect(preview.distribution).not.toBe(production.distribution);
    expect(preview.android?.buildType).not.toBe(production.android?.buildType);

    expect(easRaw).not.toMatch(/secret|password|private_key|api_key|token/i);
  });

  // =========================================================================
  // LOW-04 — Moderate minimatch Vulnerability Remediation
  // =========================================================================
  it('LOW-04: overrides @expo/fingerprint minimatch to >= 11.0.1 and preserves non-vulnerable installed versions', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
    expect(pkg.overrides?.['@expo/fingerprint']?.minimatch).toBe('^11.0.1');

    const rootMinimatchPkg = JSON.parse(
      fs.readFileSync(path.join(PROJECT_ROOT, 'node_modules/minimatch/package.json'), 'utf8')
    );
    expect(compareSemver(rootMinimatchPkg.version, '3.1.3')).toBeGreaterThanOrEqual(0);

    const fingerprintMinimatchPath = path.join(
      PROJECT_ROOT,
      'node_modules/@expo/fingerprint/node_modules/minimatch/package.json'
    );
    expect(fs.existsSync(fingerprintMinimatchPath)).toBe(true);
    const fpMinimatchPkg = JSON.parse(fs.readFileSync(fingerprintMinimatchPath, 'utf8'));
    expect(compareSemver(fpMinimatchPkg.version, '11.0.1')).toBeGreaterThanOrEqual(0);
  });
});
