import { describe, it, expect } from 'bun:test';
import './helpers/testEnv.js';

const {
  parseQavoraDate,
  isWithinDateRange,
  computeProjectDashboardMetrics,
  generateProjectReport,
  formatReportAsJSON,
  formatReportAsCSV,
  formatReportAsMarkdown,
  escapeCsvCell,
  exportGeneratedReport,
} = await import('../src/services/reportService.js');

const TZ_TEST_PROJECT = {
  id: 'proj-tz-1',
  name: 'Timezone Audit Project',
  testPlan: {
    name: 'Release Plan',
    phases: [{ id: 'ph-1', name: 'Regression Phase' }],
  },
  testSuites: [
    {
      id: 's1',
      name: 'Core Suite',
      phaseId: 'ph-1',
      testCases: [
        { id: 'tc1', title: 'Case 1', priority: 'P0', lastStatus: 'Passed' },
        { id: 'tc2', title: 'Case 2', priority: 'P1', lastStatus: 'Failed' },
      ],
    },
    {
      id: 's2',
      name: 'Secondary Suite',
      phaseId: 'ph-1',
      testCases: [
        { id: 'tc3', title: 'Case 3', priority: 'P2', lastStatus: 'Untested' },
      ],
    },
  ],
  executions: [
    {
      id: 'ex-before',
      testCaseId: 'tc1',
      status: 'PASSED',
      executedAt: '2026-05-09T23:59:59.999Z',
    },
    {
      id: 'ex-start',
      testCaseId: 'tc1',
      status: 'PASSED',
      executedAt: '2026-05-10T00:00:00.000Z',
    },
    {
      id: 'ex-mid',
      testCaseId: 'tc2',
      status: 'FAILED',
      executedAt: '2026-05-10T17:30:00.000Z',
    },
    {
      id: 'ex-end',
      testCaseId: 'tc1',
      status: 'PASSED',
      executedAt: '2026-05-10T23:59:59.999Z',
    },
    {
      id: 'ex-after',
      testCaseId: 'tc1',
      status: 'FAILED',
      executedAt: '2026-05-11T00:00:00.000Z',
    },
  ],
  executionRuns: [
    {
      id: 'run-in',
      name: 'In Window',
      status: 'Completed',
      startedAt: '2026-05-10T22:00:00.000Z',
      results: [
        { testCaseId: 'tc1', status: 'Passed' },
        { testCaseId: 'tc2', status: 'Failed' },
      ],
    },
    {
      id: 'run-out',
      name: 'Out Window',
      status: 'Completed',
      startedAt: '2026-05-09T22:00:00.000Z',
      results: [],
    },
  ],
  defects: [
    {
      id: 'def-in',
      title: 'In Defect',
      severity: 'High',
      status: 'Open',
      linkedTestCaseId: 'tc2',
      createdAt: '2026-05-10T01:00:00.000Z',
    },
    {
      id: 'def-out',
      title: 'Out Defect',
      severity: 'Critical',
      status: 'Open',
      linkedTestCaseId: 'tc1',
      createdAt: '2026-05-11T00:00:00.000Z',
    },
  ],
};

// =============================================================================
// 1. HIGH-05 — UTC Date Boundaries & Cross-Timezone Invariance
// =============================================================================
describe('HIGH-05 — UTC Date Boundaries & Cross-Timezone Invariance', () => {
  it('enforces exact UTC day boundaries [00:00:00.000Z, 23:59:59.999Z] and rejects invalid calendar dates', () => {
    expect(
      isWithinDateRange(
        '2026-05-09T23:59:59.999Z',
        'CUSTOM',
        '2026-05-10',
        '2026-05-10'
      )
    ).toBe(false);
    expect(
      isWithinDateRange(
        '2026-05-10T00:00:00.000Z',
        'CUSTOM',
        '2026-05-10',
        '2026-05-10'
      )
    ).toBe(true);
    expect(
      isWithinDateRange('2026-05-10', 'CUSTOM', '2026-05-10', '2026-05-10')
    ).toBe(true);
    expect(
      isWithinDateRange(
        '2026-05-10T23:59:59.999Z',
        'CUSTOM',
        '2026-05-10',
        '2026-05-10'
      )
    ).toBe(true);
    expect(
      isWithinDateRange(
        '2026-05-11T00:00:00.000Z',
        'CUSTOM',
        '2026-05-10',
        '2026-05-10'
      )
    ).toBe(false);

    // Offset timestamps normalize accurately to UTC
    expect(
      isWithinDateRange(
        '2026-05-10T01:00:00+05:00',
        'CUSTOM',
        '2026-05-10',
        '2026-05-10'
      )
    ).toBe(false); // 2026-05-09T20:00:00Z
    expect(
      isWithinDateRange(
        '2026-05-09T18:00:00-07:00',
        'CUSTOM',
        '2026-05-10',
        '2026-05-10'
      )
    ).toBe(true); // 2026-05-10T01:00:00Z
    expect(
      isWithinDateRange(
        '2026-05-10T18:00:00-07:00',
        'CUSTOM',
        '2026-05-10',
        '2026-05-10'
      )
    ).toBe(false); // 2026-05-11T01:00:00Z

    // Month and year boundaries
    expect(
      isWithinDateRange(
        '2026-02-28T23:59:59.999Z',
        'CUSTOM',
        '2026-03-01',
        '2026-03-01'
      )
    ).toBe(false);
    expect(
      isWithinDateRange(
        '2026-03-01T00:00:00.000Z',
        'CUSTOM',
        '2026-02-28',
        '2026-03-01'
      )
    ).toBe(true);
    expect(
      isWithinDateRange(
        '2026-01-01T23:59:59.999Z',
        'CUSTOM',
        '2025-12-31',
        '2026-01-01'
      )
    ).toBe(true);
    expect(
      isWithinDateRange(
        '2026-01-02T00:00:00.000Z',
        'CUSTOM',
        '2025-12-31',
        '2026-01-01'
      )
    ).toBe(false);

    // Invalid calendar dates do not roll over silently
    expect(parseQavoraDate('2026-02-30')).toBeNull();
    expect(parseQavoraDate('2026-04-31')).toBeNull();
    expect(parseQavoraDate('not-a-date')).toBeNull();

    // Records without a valid date are retained so un-timestamped legacy records aren't dropped
    expect(isWithinDateRange('', 'CUSTOM', '2026-05-10', '2026-05-10')).toBe(
      true
    );

    // Explicit datetime custom bounds are preserved verbatim
    expect(
      isWithinDateRange(
        '2026-05-10T11:59:59.999Z',
        'CUSTOM',
        '2026-05-10T12:00:00.000Z',
        '2026-05-10T18:00:00.000Z'
      )
    ).toBe(false);
    expect(
      isWithinDateRange(
        '2026-05-10T15:00:00.000Z',
        'CUSTOM',
        '2026-05-10T12:00:00.000Z',
        '2026-05-10T18:00:00.000Z'
      )
    ).toBe(true);
  });

  it('produces identical custom date-range reports across TZ=UTC, TZ=America/Los_Angeles, and TZ=Asia/Karachi', () => {
    const projectJson = JSON.stringify(TZ_TEST_PROJECT);
    const script = [
      "await import('./tests/helpers/testEnv.js');",
      "const { generateProjectReport } = await import('./src/services/reportService.js');",
      `const proj = ${projectJson};`,
      "const r = generateProjectReport(proj, { reportType: 'project_summary', dateFilter: 'CUSTOM', customStart: '2026-05-10', customEnd: '2026-05-10' });",
      'console.log(JSON.stringify({',
      '  execIds: r.executions.map((e) => e.id).sort(),',
      '  runIds: r.testRuns.map((x) => x.id),',
      '  defectIds: r.defects.map((d) => d.id),',
      '  kpis: { totalExecutions: r.kpis.totalExecutions, passed: r.kpis.execPassedCount, failed: r.kpis.execFailedCount }',
      '}));',
    ].join('\n');

    const resultsByTz = {};
    for (const tz of ['UTC', 'America/Los_Angeles', 'Asia/Karachi']) {
      const proc = Bun.spawnSync(['bun', '-e', script], {
        env: { ...process.env, TZ: tz },
      });
      expect(proc.exitCode).toBe(0);
      resultsByTz[tz] = JSON.parse(proc.stdout.toString().trim());
    }

    const expected = {
      execIds: ['ex-end', 'ex-mid', 'ex-start'],
      runIds: ['run-in'],
      defectIds: ['def-in'],
      kpis: { totalExecutions: 3, passed: 2, failed: 1 },
    };

    expect(resultsByTz.UTC).toEqual(expected);
    expect(resultsByTz['America/Los_Angeles']).toEqual(expected);
    expect(resultsByTz['Asia/Karachi']).toEqual(expected);
  });
});

// =============================================================================
// 2. Report Metrics, Preset Date Filters, Suite/Severity Filters & Export Formats
// =============================================================================
describe('Report Metrics & Date-Range Edge Cases', () => {
  it('filters 7D, 30D, 90D, and ALL ranges relative to deterministic referenceNow', () => {
    const refNow = new Date('2026-06-01T12:00:00.000Z');
    expect(
      isWithinDateRange('2026-05-26T00:00:00.000Z', '7D', '', '', refNow)
    ).toBe(true);
    expect(
      isWithinDateRange('2026-05-20T00:00:00.000Z', '7D', '', '', refNow)
    ).toBe(false);
    expect(
      isWithinDateRange('2026-05-10T00:00:00.000Z', '30D', '', '', refNow)
    ).toBe(true);
    expect(
      isWithinDateRange('2026-04-20T00:00:00.000Z', '30D', '', '', refNow)
    ).toBe(false);
    expect(
      isWithinDateRange('2026-03-15T00:00:00.000Z', '90D', '', '', refNow)
    ).toBe(true);
    expect(
      isWithinDateRange('2025-12-01T00:00:00.000Z', '90D', '', '', refNow)
    ).toBe(false);
    expect(
      isWithinDateRange('2020-01-01T00:00:00.000Z', 'ALL', '', '', refNow)
    ).toBe(true);
  });

  it('computes dashboard healthStatus accurately across NO DATA, HEALTHY, AT RISK, and CRITICAL states', () => {
    const emptyMetrics = computeProjectDashboardMetrics({
      id: 'p0',
      name: 'Empty',
      testSuites: [],
      executions: [],
      executionRuns: [],
      defects: [],
    });
    expect(emptyMetrics.healthStatus).toBe('NO DATA');

    const healthyMetrics = computeProjectDashboardMetrics({
      id: 'p1',
      name: 'Healthy',
      testSuites: [
        {
          id: 's1',
          name: 'Suite',
          testCases: [
            { id: 'c1', lastStatus: 'Passed' },
            { id: 'c2', lastStatus: 'Passed' },
          ],
        },
      ],
      executions: [
        { id: 'e1', testCaseId: 'c1', status: 'PASSED' },
        { id: 'e2', testCaseId: 'c2', status: 'PASSED' },
      ],
      defects: [
        { id: 'd1', severity: 'Critical', status: 'Resolved' },
      ],
    });
    expect(healthyMetrics.healthStatus).toBe('HEALTHY');
    expect(healthyMetrics.passRate).toBe(100);
    expect(healthyMetrics.defectResolutionRate).toBe(100);

    const atRiskMetrics = computeProjectDashboardMetrics({
      id: 'p2',
      name: 'At Risk',
      testSuites: [
        {
          id: 's1',
          name: 'Suite',
          testCases: [{ id: 'c1', lastStatus: 'Passed' }],
        },
      ],
      executions: [{ id: 'e1', testCaseId: 'c1', status: 'PASSED' }],
      defects: [{ id: 'd1', severity: 'High', status: 'Open' }],
    });
    expect(atRiskMetrics.healthStatus).toBe('AT RISK');

    const criticalMetrics = computeProjectDashboardMetrics(TZ_TEST_PROJECT);
    expect(criticalMetrics.healthStatus).toBe('CRITICAL');
    expect(criticalMetrics.criticalOnlyActiveDefects).toBe(1);
    expect(criticalMetrics.totalTestCases).toBe(3);
    expect(criticalMetrics.coverageRate).toBe(67);
  });

  it('applies suiteId and severityFilter and serializes clean JSON, CSV, and Markdown reports', () => {
    const suiteReport = generateProjectReport(TZ_TEST_PROJECT, {
      reportType: 'project_summary',
      suiteId: 's1',
      severityFilter: 'Critical',
    });

    expect(suiteReport.kpis.totalTestCases).toBe(2);
    expect(suiteReport.defects.map((d) => d.id)).toEqual(['def-out']);

    const jsonText = formatReportAsJSON(suiteReport);
    const parsed = JSON.parse(jsonText);
    expect(parsed.project.name).toBe('Timezone Audit Project');
    expect(parsed.kpis.totalTestCases).toBe(2);

    const csvText = formatReportAsCSV(suiteReport);
    expect(csvText).toContain('QAVORA QA REPORT EXPORT');
    expect(csvText).toContain('KPI Metric');
    expect(csvText).toContain('Timezone Audit Project');
    expect(csvText).toContain('DEFECTS LOG');

    const mdText = formatReportAsMarkdown(suiteReport);
    expect(mdText).toContain('# Qavora QA Report');
    expect(mdText).toContain('Executive KPI Summary');
  });
});

// =============================================================================
// 3. CRIT-05 — Report Service CSV Formula-Injection Protection
// =============================================================================
describe('CRIT-05 — Report Service CSV Formula-Injection Protection', () => {
  it('neutralizes =, +, -, @, tab, and CR triggers without double-sanitizing or altering safe text', () => {
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
    expect(escapeCsvCell('Safe Text')).toBe('Safe Text');
    expect(escapeCsvCell('Café ✅ — 日本語')).toBe('Café ✅ — 日本語');
    expect(escapeCsvCell(-42)).toBe("'-42");
    expect(escapeCsvCell('=SUM(1,1)')).toBe(`"'=SUM(1,1)"`);
    expect(escapeCsvCell('+1+1')).toBe("'+1+1");
    expect(escapeCsvCell('-1+1')).toBe("'-1+1");
    expect(escapeCsvCell('@SUM(1,1)')).toBe(`"'@SUM(1,1)"`);
    expect(escapeCsvCell('\t=1+1')).toBe("'\t=1+1");
    expect(escapeCsvCell('\r=1+1')).toBe(`"'\r=1+1"`);
    expect(escapeCsvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
    expect(escapeCsvCell('=HYPERLINK("http://evil.test","Click")')).toBe(
      `"'=HYPERLINK(""http://evil.test"",""Click"")"`
    );

    // Already-sanitized single-quote prefix is not double-prefixed
    expect(escapeCsvCell("'=SUM(1,1)")).toBe(`"'=SUM(1,1)"`);
    expect(escapeCsvCell("'+1+1")).toBe("'+1+1");
  });

  it('sanitizes formula-triggering values across test cases, executions, test runs, defects, and project summary CSV exports while leaving JSON and Markdown intact', async () => {
    const hostileReportProject = {
      id: 'proj-report-csv',
      name: '=HYPERLINK("http://evil.example","Click")',
      status: 'Active',
      testSuites: [
        {
          id: 'suite-evil',
          name: '@SUM(1+1)*cmd',
          category: '+Security',
          testCases: [
            {
              id: '=TC-1',
              title: '-2+3+cmd|"/C calc"!A0',
              priority: 'P0',
              testType: '\tFunctional',
              lastStatus: 'Failed',
              updatedAt: '2026-05-10T10:00:00.000Z',
            },
          ],
        },
      ],
      executions: [
        {
          id: 'ex-1',
          testCaseId: '=TC-1',
          caseTitle: '=cmd|"/C calc"!A0',
          suiteName: '@SUM(1+1)*cmd',
          status: 'FAILED',
          tester: '+attacker',
          environment: '-prod',
          buildVersion: '\t=build',
          executedAt: '2026-05-10T10:00:00.000Z',
        },
      ],
      executionRuns: [
        {
          id: 'run-1',
          name: '=IMPORTXML("http://evil.test","//a")',
          suiteName: '@SUM(1+1)*cmd',
          status: 'Completed',
          buildVersion: '+1.0',
          deviceInfo: '\r=device',
          environment: '-staging',
          tester: '\t@qa',
          startedAt: '2026-05-10T10:00:00.000Z',
          results: [{ testCaseId: '=TC-1', status: 'Failed' }],
        },
      ],
      defects: [
        {
          id: '@DEF-1',
          defectId: '@DEF-1',
          title: '=2+5, "Café ✅"',
          severity: 'Critical',
          priority: 'P0',
          status: 'Open',
          assignee: '-admin\nline2',
          updatedAt: '2026-05-10T10:00:00.000Z',
        },
      ],
    };

    const summaryReport = generateProjectReport(hostileReportProject, {
      reportType: 'project_summary',
    });
    const summaryCsv = formatReportAsCSV(summaryReport);

    // Header & section structure remain intact
    expect(summaryCsv).toContain('QAVORA QA REPORT EXPORT');
    expect(summaryCsv).toContain('KPI Metric,Value');
    expect(summaryCsv).toContain('TEST SUITES QUALITY & COVERAGE');
    expect(summaryCsv).toContain('RECENT TEST EXECUTIONS LOG');
    expect(summaryCsv).toContain('TEST RUN CYCLES');
    expect(summaryCsv).toContain('DEFECTS LOG');

    // Formula payloads are safely neutralized with leading apostrophe (and quoted when containing CSV specials)
    expect(summaryCsv).toContain(`"'=HYPERLINK(""http://evil.example"",""Click"")"`);
    expect(summaryCsv).toContain("'@SUM(1+1)*cmd");
    expect(summaryCsv).toContain("'+Security");
    expect(summaryCsv).toContain("'=TC-1");
    expect(summaryCsv).toContain(`"'=cmd|""/C calc""!A0"`);
    expect(summaryCsv).toContain("'+attacker");
    expect(summaryCsv).toContain("'-prod");
    expect(summaryCsv).toContain("'\t=build");
    expect(summaryCsv).toContain(`"'=IMPORTXML(""http://evil.test"",""//a"")"`);
    expect(summaryCsv).toContain(`"'\r=device"`);
    expect(summaryCsv).toContain("'\t@qa");
    expect(summaryCsv).toContain("'@DEF-1");
    expect(summaryCsv).toContain(`"'=2+5, ""Café ✅"""`);
    expect(summaryCsv).toContain(`"'-admin\nline2"`);

    // Test Case Status report type uses the same neutralized CSV path
    const caseStatusReport = generateProjectReport(hostileReportProject, {
      reportType: 'case_status',
    });
    const caseStatusCsv = formatReportAsCSV(caseStatusReport);
    expect(caseStatusCsv).toContain('TEST CASES STATUS LOG');
    expect(caseStatusCsv).toContain(`"'-2+3+cmd|""/C calc""!A0"`);
    expect(caseStatusCsv).toContain("'\tFunctional");

    // exportGeneratedReport routes CSV through formatReportAsCSV cleanly
    const exportedCsv = await exportGeneratedReport(caseStatusReport, 'csv', {
      skipPlatformShare: true,
    });
    expect(exportedCsv.ok).toBe(true);
    expect(exportedCsv.content).toBe(caseStatusCsv);

    // JSON and Markdown exports remain unmangled (no apostrophe prefixes added)
    const jsonParsed = JSON.parse(formatReportAsJSON(summaryReport));
    expect(jsonParsed.project.name).toBe('=HYPERLINK("http://evil.example","Click")');
    expect(jsonParsed.defects[0].title).toBe('=2+5, "Café ✅"');
    const mdOut = formatReportAsMarkdown(summaryReport);
    expect(mdOut).toContain('=HYPERLINK("http://evil.example","Click")');
    expect(mdOut).toContain('=2+5, "Café ✅"');
  });
});
