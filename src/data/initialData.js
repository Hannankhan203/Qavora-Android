export const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];

export const TEST_TYPES = [
  'Functional',
  'Regression',
  'Smoke',
  'UI/UX',
  'Integration',
];

export const EXECUTION_STATUSES = ['Passed', 'Failed', 'Blocked', 'Untested'];

export const DEFECT_SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];

export const DEFECT_STATUSES = [
  'Open',
  'In Progress',
  'Ready for Retest',
  'Closed',
];

export const INITIAL_SUITES = [
  {
    id: 'suite-auth',
    name: 'Authentication & Session',
    description: 'Login validation, session timeout, and credential error handling',
  },
  {
    id: 'suite-nav',
    name: 'Mobile Navigation & Layout',
    description: 'Bottom tab routing, safe area insets, Android back gesture, 360dp responsiveness',
  },
  {
    id: 'suite-execution',
    name: 'Test Execution & Runner',
    description: 'Pass/Fail/Blocked status recording, device metadata, and defect creation',
  },
  {
    id: 'suite-storage',
    name: 'Offline & Local Storage',
    description: 'AsyncStorage CRUD persistence across app restarts on Android and Web',
  },
];

export const INITIAL_PROFILE = {
  testerName: 'QA Engineer',
  role: 'Lead QA Analyst',
  projectName: 'Qavora Mobile App',
  targetVersion: 'v1.0.0',
  defaultDevice: 'Android 15 · Pixel 8 (360dp)',
  defaultBuild: '1.0.0-build.104',
  storageMode: 'Local AsyncStorage (Device-Only)',
};

export const INITIAL_TEST_CASES = [
  {
    id: 'TC-101',
    suiteId: 'suite-auth',
    suiteName: 'Authentication & Session',
    title: 'Verify invalid email format triggers inline validation error',
    description:
      'Ensures the form rejects malformed email addresses before attempting session creation.',
    preconditions: 'App is launched on the form input screen with empty fields.',
    priority: 'P0',
    testType: 'Functional',
    steps: [
      {
        id: 'step-1',
        stepNumber: 1,
        action: 'Enter an email string without an "@" symbol (e.g., "qa.tester.example.com").',
        expectedResult: 'Input accepts text entry without crashing.',
      },
      {
        id: 'step-2',
        stepNumber: 2,
        action: 'Tap the Submit button.',
        expectedResult: 'Inline validation banner displays clear error message and blocks submission.',
      },
    ],
    expectedResult:
      'Inline validation error is displayed and invalid submission is blocked.',
    lastStatus: 'Passed',
    createdAt: '2026-11-05 09:30',
    updatedAt: '2026-11-06 14:15',
  },
  {
    id: 'TC-102',
    suiteId: 'suite-nav',
    suiteName: 'Mobile Navigation & Layout',
    title: 'Verify bottom navigation bar renders 5 tabs without horizontal overflow at 360dp',
    description:
      'Validates that Dashboard, Test Cases, Test Runs, Defects, and Profile tabs fit cleanly on compact 360dp–390dp Android viewports.',
    preconditions: 'Device or emulator viewport width set between 360dp and 390dp.',
    priority: 'P0',
    testType: 'UI/UX',
    steps: [
      {
        id: 'step-3',
        stepNumber: 1,
        action: 'Inspect the top header and bottom navigation bar on a 360dp screen.',
        expectedResult: 'Top bar shows only current screen context; bottom bar displays all 5 tabs.',
      },
      {
        id: 'step-4',
        stepNumber: 2,
        action: 'Tap each of the 5 bottom navigation tabs sequentially.',
        expectedResult: 'Each screen renders immediately with zero clipped labels or horizontal scrolling.',
      },
    ],
    expectedResult:
      'Single bottom navigation bar switches across all 5 modules cleanly on 360dp screens.',
    lastStatus: 'Passed',
    createdAt: '2026-11-05 10:15',
    updatedAt: '2026-11-06 16:40',
  },
  {
    id: 'TC-103',
    suiteId: 'suite-execution',
    suiteName: 'Test Execution & Runner',
    title: 'Verify marking a test case as Failed allows immediate linked Defect creation',
    description:
      'Checks that failing a test case inside an active Test Run records actual results and pre-fills a linked defect report.',
    preconditions: 'At least one active Test Run exists containing TC-103.',
    priority: 'P1',
    testType: 'Integration',
    steps: [
      {
        id: 'step-5',
        stepNumber: 1,
        action: 'Open an active Test Run and select a test case row.',
        expectedResult: 'Execution runner modal opens with Pass, Fail, Blocked, and Untested controls.',
      },
      {
        id: 'step-6',
        stepNumber: 2,
        action: 'Select "Failed", enter Actual Result notes, and tap "Save & Log Defect".',
        expectedResult: 'Test status updates to Failed and new Defect is created with linked Test Case ID.',
      },
    ],
    expectedResult:
      'Failed execution status is saved and a linked Defect record is added to the Defects module.',
    lastStatus: 'Failed',
    createdAt: '2026-11-05 11:00',
    updatedAt: '2026-11-06 17:10',
  },
  {
    id: 'TC-104',
    suiteId: 'suite-storage',
    suiteName: 'Offline & Local Storage',
    title: 'Verify newly created Test Cases and Defects persist in AsyncStorage after reload',
    description:
      'Ensures all CRUD changes are serialized to AsyncStorage and restored accurately on application restart.',
    preconditions: 'Local AsyncStorage is initialized.',
    priority: 'P0',
    testType: 'Regression',
    steps: [
      {
        id: 'step-7',
        stepNumber: 1,
        action: 'Create a new Test Case with 2 steps and priority P1.',
        expectedResult: 'New Test Case appears in the list and increments Dashboard total.',
      },
      {
        id: 'step-8',
        stepNumber: 2,
        action: 'Reload the application in Expo Go or Web preview.',
        expectedResult: 'Created Test Case and updated Dashboard metrics remain intact.',
      },
    ],
    expectedResult:
      'All created, edited, and deleted QA records persist across reloads via AsyncStorage.',
    lastStatus: 'Passed',
    createdAt: '2026-11-05 13:20',
    updatedAt: '2026-11-06 18:00',
  },
  {
    id: 'TC-105',
    suiteId: 'suite-nav',
    suiteName: 'Mobile Navigation & Layout',
    title: 'Verify Android software keyboard does not obscure modal save buttons',
    description:
      'Validates KeyboardAvoidingView behavior inside Create/Edit modals when focusing bottom text inputs.',
    preconditions: 'Open Create Defect or Create Test Case modal on Android.',
    priority: 'P1',
    testType: 'UI/UX',
    steps: [
      {
        id: 'step-9',
        stepNumber: 1,
        action: 'Focus the "Expected Result" or "Actual Result" multiline input at the bottom of the form.',
        expectedResult: 'Form scrolls smoothly above the keyboard and Save button remains reachable.',
      },
    ],
    expectedResult:
      'All form fields and action buttons remain accessible while the software keyboard is visible.',
    lastStatus: 'Blocked',
    createdAt: '2026-11-06 09:00',
    updatedAt: '2026-11-06 15:20',
  },
  {
    id: 'TC-106',
    suiteId: 'suite-auth',
    suiteName: 'Authentication & Session',
    title: 'Verify Android hardware Back button closes active modal before switching tabs',
    description:
      'Confirms BackHandler intercepts hardware back presses when a detail or form modal is open.',
    preconditions: 'Navigate to Test Cases tab and open any test case detail modal.',
    priority: 'P2',
    testType: 'Smoke',
    steps: [
      {
        id: 'step-10',
        stepNumber: 1,
        action: 'Press the Android hardware/gesture Back button while detail modal is open.',
        expectedResult: 'Modal closes cleanly while keeping the user on the Test Cases tab.',
      },
    ],
    expectedResult:
      'Hardware Back gesture dismisses modals first, then returns non-Dashboard tabs to Dashboard.',
    lastStatus: 'Untested',
    createdAt: '2026-11-06 11:45',
    updatedAt: '2026-11-06 11:45',
  },
];

export const INITIAL_TEST_RUNS = [
  {
    id: 'RUN-201',
    name: 'v1.0.0 Core Regression Cycle',
    suiteName: 'All Suites',
    buildVersion: '1.0.0-build.104',
    deviceInfo: 'Pixel 8 · Android 15 (Expo Go)',
    environment: 'Local QA Build',
    status: 'In Progress',
    createdAt: '2026-11-06 14:00',
    updatedAt: '2026-11-06 18:05',
    results: [
      {
        testCaseId: 'TC-101',
        status: 'Passed',
        actualResult: 'Inline error message displayed immediately when "@" was omitted.',
        notes: 'Verified in both Light and Dark mode.',
        executedAt: '2026-11-06 14:15',
        linkedDefectId: null,
      },
      {
        testCaseId: 'TC-102',
        status: 'Passed',
        actualResult: 'All 5 bottom tabs fit inside 360dp width with 48dp touch height.',
        notes: 'Zero horizontal clipping.',
        executedAt: '2026-11-06 16:40',
        linkedDefectId: null,
      },
      {
        testCaseId: 'TC-103',
        status: 'Failed',
        actualResult: 'Attachment thumbnail preview overflowed container width on 360dp portrait.',
        notes: 'Logged BUG-301 for container width constraint.',
        executedAt: '2026-11-06 17:10',
        linkedDefectId: 'BUG-301',
      },
      {
        testCaseId: 'TC-104',
        status: 'Passed',
        actualResult: 'AsyncStorage restored all 6 test cases and 2 defects after full reload.',
        notes: 'Tested on Android & Web.',
        executedAt: '2026-11-06 18:00',
        linkedDefectId: null,
      },
      {
        testCaseId: 'TC-105',
        status: 'Blocked',
        actualResult: 'Awaiting physical Android 13 small-screen device verification.',
        notes: 'Emulator check passed; physical check pending.',
        executedAt: '2026-11-06 15:20',
        linkedDefectId: 'BUG-302',
      },
      {
        testCaseId: 'TC-106',
        status: 'Untested',
        actualResult: '',
        notes: '',
        executedAt: null,
        linkedDefectId: null,
      },
    ],
  },
  {
    id: 'RUN-202',
    name: 'v1.0.0 Smoke Verification Run',
    suiteName: 'Authentication & Session',
    buildVersion: '1.0.0-build.103',
    deviceInfo: 'Samsung Galaxy S23 · Android 14',
    environment: 'Staging APK',
    status: 'Completed',
    createdAt: '2026-11-05 16:00',
    updatedAt: '2026-11-05 17:30',
    results: [
      {
        testCaseId: 'TC-101',
        status: 'Passed',
        actualResult: 'Validation error rendered as expected.',
        notes: 'Smoke check passed.',
        executedAt: '2026-11-05 16:25',
        linkedDefectId: null,
      },
      {
        testCaseId: 'TC-102',
        status: 'Passed',
        actualResult: 'Bottom navigation bar responsive on S23 viewport.',
        notes: 'Smoke check passed.',
        executedAt: '2026-11-05 16:50',
        linkedDefectId: null,
      },
      {
        testCaseId: 'TC-104',
        status: 'Passed',
        actualResult: 'Local storage persisted state cleanly.',
        notes: 'Verified.',
        executedAt: '2026-11-05 17:30',
        linkedDefectId: null,
      },
    ],
  },
];

export const INITIAL_DEFECTS = [
  {
    id: 'BUG-301',
    title: 'Long reproduction step text wraps without right padding on 360dp cards',
    description:
      'When a defect reproduction step contains an unbroken 60-character URL or stack trace, the text touches the right border on 360dp screens.',
    severity: 'High',
    status: 'Open',
    reproductionSteps:
      '1. Open Defects tab on a 360dp Android screen.\n2. Create a defect with a long stack trace line.\n3. Inspect the rendered card.',
    expectedResult:
      'Text wraps cleanly within container padding (flexShrink: 1) without touching card borders.',
    actualResult:
      'Long unbroken string extends close to the right edge prior to flexShrink fix.',
    environment: 'Pixel 8 · Android 15 · Build 1.0.0-build.104',
    linkedTestCaseId: 'TC-103',
    linkedTestRunId: 'RUN-201',
    createdAt: '2026-11-06 17:12',
    updatedAt: '2026-11-06 17:12',
  },
  {
    id: 'BUG-302',
    title: 'Multiline notes field in Test Run modal needs automatic scroll-to-bottom on focus',
    description:
      'On smaller 5.8-inch Android screens with large font scaling (1.3x), focusing the notes input requires manual scrolling to see the Save button.',
    severity: 'Medium',
    status: 'In Progress',
    reproductionSteps:
      '1. Set Android system font scale to 130%.\n2. Open RUN-201 and tap TC-105.\n3. Tap into the Execution Notes field.',
    expectedResult:
      'KeyboardAvoidingView shifts the modal content so both the input and Save button remain visible.',
    actualResult:
      'User has to scroll 40dp downward when system font scale is set to 130%.',
    environment: 'Android 14 · 360x740dp · Font Scale 1.3x',
    linkedTestCaseId: 'TC-105',
    linkedTestRunId: 'RUN-201',
    createdAt: '2026-11-06 15:25',
    updatedAt: '2026-11-06 16:00',
  },
];

export const INITIAL_ACTIVITY = [
  {
    id: 'act-1',
    category: 'execution',
    title: 'Executed TC-104 in RUN-201 → Passed',
    detail: 'AsyncStorage restored all test cases and defects after reload.',
    timestamp: '2026-11-06 18:00',
  },
  {
    id: 'act-2',
    category: 'defect',
    title: 'Logged BUG-301 (High) from failed TC-103',
    detail: 'Linked to v1.0.0 Core Regression Cycle (RUN-201).',
    timestamp: '2026-11-06 17:12',
  },
  {
    id: 'act-3',
    category: 'execution',
    title: 'Executed TC-103 in RUN-201 → Failed',
    detail: 'Recorded actual result and linked BUG-301.',
    timestamp: '2026-11-06 17:10',
  },
  {
    id: 'act-4',
    category: 'testcase',
    title: 'Updated TC-102 expected results',
    detail: 'Added 360dp–390dp viewport verification criteria.',
    timestamp: '2026-11-06 16:40',
  },
];
