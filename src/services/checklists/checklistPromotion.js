/**
 * Qavora Android — Checklist-to-Project Promotion Mapping & Preview Builder
 *
 * Deterministic mapping of checklist phases, categories, and verification items
 * into Qavora project test plans, test suites, and test cases (`TC-XXX`).
 */

import {
  buildDefaultTestPlan,
  extractSuiteTestCases,
  normalizeProject,
} from '../projectService.js';
import {
  normalizeChecklistItem,
  normalizeChecklistRecord,
} from './checklistNormalization.js';

/**
 * Maps a checklist priority (`Critical`, `High`, `Medium`, `Low`, or `P0`–`P3`)
 * to the Qavora project test case priority format (`P0`–`P3`).
 *
 * @param {string} priority
 * @returns {'P0' | 'P1' | 'P2' | 'P3'}
 */
export function mapChecklistPriorityToCasePriority(priority) {
  const normalized = String(priority || '')
    .trim()
    .toLowerCase();
  if (normalized === 'critical' || normalized === 'p0') return 'P0';
  if (normalized === 'high' || normalized === 'p1') return 'P1';
  if (normalized === 'low' || normalized === 'p3') return 'P3';
  return 'P2';
}

/**
 * Normalizes a checklist category or suite name into a clean suite category string.
 *
 * @param {string} category
 * @returns {string}
 */
export function mapChecklistCategoryToSuiteCategory(category) {
  if (typeof category === 'string' && category.trim()) {
    return category.trim();
  }
  return 'General QA';
}

/**
 * Extracts structured phases from a normalized or raw checklist record.
 *
 * @param {object} checklist
 * @returns {Array<object>}
 */
function extractStructuredChecklistPhases(checklist) {
  const normalized = normalizeChecklistRecord(checklist) || checklist || {};
  const checklistTitle =
    typeof normalized.title === 'string' && normalized.title.trim()
      ? normalized.title.trim()
      : 'Promoted Checklist';
  const checklistDescription =
    typeof normalized.description === 'string' && normalized.description.trim()
      ? normalized.description.trim()
      : `Promoted from QA Checklist "${checklistTitle}".`;
  const checklistCategory = mapChecklistCategoryToSuiteCategory(
    normalized.category
  );

  const rawPhases = Array.isArray(checklist && checklist.phases)
    ? checklist.phases
    : Array.isArray(normalized.phases)
    ? normalized.phases
    : [];

  const flatItems = Array.isArray(normalized.items) ? normalized.items : [];
  const itemLookup = new Map();
  flatItems.forEach((it) => {
    if (it && it.id) {
      itemLookup.set(String(it.id).trim(), it);
    }
  });

  const hasMultipleOrCustomPhases =
    rawPhases.length > 1 ||
    (rawPhases.length === 1 &&
      rawPhases[0] &&
      typeof rawPhases[0] === 'object' &&
      rawPhases[0].id &&
      rawPhases[0].id !== 'phase_main') ||
    flatItems.some(
      (it) =>
        (it.phaseId && it.phaseId !== 'phase_main') ||
        (it.phaseTitle &&
          it.phaseTitle !== checklistCategory &&
          it.phaseTitle !== 'Checklist Items')
    );

  if (hasMultipleOrCustomPhases) {
    const phaseGroups = new Map();

    rawPhases.forEach((rawPhase, idx) => {
      if (!rawPhase || typeof rawPhase !== 'object') return;
      const pId =
        typeof rawPhase.id === 'string' && rawPhase.id.trim()
          ? rawPhase.id.trim()
          : `phase_${idx + 1}`;
      const rawPhaseTitle =
        typeof rawPhase.title === 'string' && rawPhase.title.trim()
          ? rawPhase.title.trim()
          : typeof rawPhase.name === 'string' && rawPhase.name.trim()
          ? rawPhase.name.trim()
          : `Phase ${idx + 1}`;
      const pTitle =
        pId === 'phase_main' &&
        (rawPhaseTitle === checklistCategory ||
          rawPhaseTitle === 'Checklist Items')
          ? `Checklist: ${checklistTitle}`
          : rawPhaseTitle;
      const pDesc =
        typeof rawPhase.description === 'string' && rawPhase.description.trim()
          ? rawPhase.description.trim()
          : checklistDescription;
      const pCategory = mapChecklistCategoryToSuiteCategory(
        rawPhase.category || checklistCategory
      );

      if (!phaseGroups.has(pId)) {
        phaseGroups.set(pId, {
          sourcePhaseId: pId,
          title: pTitle,
          description: pDesc,
          category: pCategory,
          items: [],
        });
      }

      const phaseItems = Array.isArray(rawPhase.items)
        ? rawPhase.items
        : Array.isArray(rawPhase.tasks)
        ? rawPhase.tasks
        : [];

      phaseItems.forEach((rawIt, itIdx) => {
        const normIt =
          (rawIt && rawIt.id && itemLookup.get(String(rawIt.id).trim())) ||
          normalizeChecklistItem(rawIt, itIdx);
        if (!normIt) return;
        const group = phaseGroups.get(pId);
        if (!group.items.some((existing) => existing.id === normIt.id)) {
          group.items.push({
            ...normIt,
            phaseId: pId,
            phaseTitle: pTitle,
            category: mapChecklistCategoryToSuiteCategory(
              rawIt.category || normIt.category || pCategory
            ),
          });
        }
      });
    });

    const placedIds = new Set();
    for (const grp of phaseGroups.values()) {
      grp.items.forEach((it) => placedIds.add(it.id));
    }

    flatItems.forEach((item) => {
      if (!item || placedIds.has(item.id)) return;
      const pId = item.phaseId || 'phase_main';
      const pTitle =
        item.phaseTitle &&
        item.phaseTitle !== checklistCategory &&
        item.phaseTitle !== 'Checklist Items'
          ? item.phaseTitle
          : `Checklist: ${checklistTitle}`;
      if (!phaseGroups.has(pId)) {
        phaseGroups.set(pId, {
          sourcePhaseId: pId,
          title: pTitle,
          description: checklistDescription,
          category: mapChecklistCategoryToSuiteCategory(
            item.category || checklistCategory
          ),
          items: [],
        });
      }
      phaseGroups.get(pId).items.push({
        ...item,
        phaseId: pId,
        phaseTitle: phaseGroups.get(pId).title,
      });
      placedIds.add(item.id);
    });

    if (phaseGroups.size > 0) {
      return Array.from(phaseGroups.values());
    }
  }

  return [
    {
      sourcePhaseId: 'phase_main',
      title: `Checklist: ${checklistTitle}`,
      description: checklistDescription,
      category: checklistCategory,
      items: flatItems.map((it) => ({
        ...it,
        phaseId: 'phase_main',
        phaseTitle: `Checklist: ${checklistTitle}`,
        category: mapChecklistCategoryToSuiteCategory(
          it.category || checklistCategory
        ),
      })),
    },
  ];
}

/**
 * Builds a deterministic, side-effect-free preview of promoting `checklist` into
 * `targetProject`.
 *
 * @param {object} checklist
 * @param {object} targetProject
 * @returns {object}
 */
export function buildChecklistPromotionPreview(checklist, targetProject) {
  const normChecklist = normalizeChecklistRecord(checklist);
  if (!normChecklist) {
    return {
      valid: false,
      error: 'A valid checklist is required for promotion.',
    };
  }

  const normProject =
    targetProject && typeof targetProject === 'object'
      ? normalizeProject(targetProject) || targetProject
      : null;

  if (!normProject || !normProject.id) {
    return {
      valid: false,
      error: 'Please select a valid destination project.',
    };
  }

  const checklistId = String(normChecklist.id).trim();
  const checklistTitle = normChecklist.title || 'Untitled Checklist';
  const checklistDescription =
    normChecklist.description ||
    `Promoted from QA Checklist "${checklistTitle}".`;
  const checklistCategory = mapChecklistCategoryToSuiteCategory(
    normChecklist.category
  );
  const checklistPriority = normChecklist.priority || 'Medium';
  const checklistEnvironment =
    normChecklist.environment || normProject.environment || 'Staging';
  const checklistTargetRelease =
    normChecklist.targetRelease || normProject.version || '';

  const structuredPhases = extractStructuredChecklistPhases(checklist);

  const existingTestPlan = buildDefaultTestPlan(normProject);
  const existingPhases = Array.isArray(existingTestPlan.phases)
    ? existingTestPlan.phases.map((p) => ({ ...p }))
    : [];
  const existingSuites = Array.isArray(normProject.testSuites)
    ? normProject.testSuites.map((s) => {
        const cases = extractSuiteTestCases(s).map((c) => ({ ...c }));
        return {
          ...s,
          cases,
          testCases: cases,
        };
      })
    : [];

  const existingItemKeys = new Set();
  let maxCaseNum = 0;

  existingSuites.forEach((suite) => {
    const suiteCases = extractSuiteTestCases(suite);
    suiteCases.forEach((tc) => {
      if (!tc || typeof tc !== 'object') return;
      const match = String(tc.id || '').match(/^TC-(\d+)$/i);
      if (match) {
        const parsed = parseInt(match[1], 10);
        if (parsed > maxCaseNum) maxCaseNum = parsed;
      }
      if (
        tc.sourceChecklistId &&
        String(tc.sourceChecklistId) === checklistId &&
        tc.sourceChecklistItemId
      ) {
        existingItemKeys.add(
          `${checklistId}:${String(tc.sourceChecklistItemId)}`
        );
      }
    });
  });

  let nextCaseNum = Math.max(
    maxCaseNum,
    existingSuites.reduce((sum, s) => sum + extractSuiteTestCases(s).length, 0)
  );

  const nextPhases = existingPhases.map((p) => ({ ...p }));
  const nextSuites = existingSuites.map((s) => {
    const clonedCases = extractSuiteTestCases(s).map((c) => ({ ...c }));
    return {
      ...s,
      cases: clonedCases,
      testCases: clonedCases,
    };
  });

  const phasesSummary = [];
  const suitesSummaryMap = new Map();
  const casesToCreate = [];
  const skippedDuplicateItems = [];

  structuredPhases.forEach((srcPhase, phaseIdx) => {
    const phaseTitle = srcPhase.title || `Checklist: ${checklistTitle}`;
    const phaseKey = `${checklistId}:${srcPhase.sourcePhaseId}`;

    let targetPhase = nextPhases.find(
      (p) =>
        (p.sourceChecklistId === checklistId &&
          p.sourceChecklistPhaseId === srcPhase.sourcePhaseId) ||
        (p.sourceChecklistId === checklistId &&
          structuredPhases.length === 1) ||
        String(p.name || p.title || '')
          .trim()
          .toLowerCase() === phaseTitle.trim().toLowerCase()
    );

    let phaseAction = 'reused';
    if (!targetPhase) {
      phaseAction = 'created';
      const newPhaseId = `ph_chk_${checklistId
        .replace(/[^a-zA-Z0-9]/g, '')
        .slice(-8)}_${phaseIdx + 1}`;
      const phaseItemsTotal = srcPhase.items.length;
      const phaseItemsDone = srcPhase.items.filter((it) => it.completed).length;
      const phaseStatus =
        phaseItemsTotal > 0 && phaseItemsDone === phaseItemsTotal
          ? 'Completed'
          : phaseItemsDone > 0
          ? 'In Progress'
          : 'Planned';

      targetPhase = {
        id: newPhaseId,
        name: phaseTitle,
        title: phaseTitle,
        description:
          srcPhase.description ||
          checklistDescription ||
          `Promoted from checklist "${checklistTitle}"`,
        entryCriteria: `Checklist "${checklistTitle}" promoted to project (${checklistEnvironment}${
          checklistTargetRelease ? ` • ${checklistTargetRelease}` : ''
        }).`,
        exitCriteria:
          'All promoted checklist verification cases executed and passed.',
        status: phaseStatus,
        sourceChecklistId: checklistId,
        sourceChecklistPhaseId: srcPhase.sourcePhaseId,
        sourceChecklistTitle: checklistTitle,
      };
      nextPhases.push(targetPhase);
    }

    phasesSummary.push({
      id: targetPhase.id,
      name: targetPhase.name || targetPhase.title,
      description: targetPhase.description,
      action: phaseAction,
      itemCount: srcPhase.items.length,
      phaseKey,
    });

    const categoriesInPhase = new Map();
    if (srcPhase.items.length === 0) {
      const emptyCat = mapChecklistCategoryToSuiteCategory(
        srcPhase.category || checklistCategory
      );
      categoriesInPhase.set(emptyCat, []);
    } else {
      srcPhase.items.forEach((item) => {
        const cat = mapChecklistCategoryToSuiteCategory(
          item.category || srcPhase.category || checklistCategory
        );
        if (!categoriesInPhase.has(cat)) {
          categoriesInPhase.set(cat, []);
        }
        categoriesInPhase.get(cat).push(item);
      });
    }

    for (const [catName, catItems] of categoriesInPhase.entries()) {
      const desiredSuiteName =
        structuredPhases.length > 1
          ? `${phaseTitle} — ${catName}`
          : `${checklistTitle} — ${catName}`;

      let targetSuite = nextSuites.find(
        (s) =>
          (s.sourceChecklistId === checklistId &&
            String(s.category || '').toLowerCase() === catName.toLowerCase() &&
            (!s.phaseId || s.phaseId === targetPhase.id)) ||
          String(s.name || s.title || '')
            .trim()
            .toLowerCase() === desiredSuiteName.trim().toLowerCase()
      );

      let suiteAction = 'reused';
      if (!targetSuite) {
        suiteAction = 'created';
        const newSuiteId = `suite_chk_${checklistId
          .replace(/[^a-zA-Z0-9]/g, '')
          .slice(-8)}_${nextSuites.length + 1}`;
        targetSuite = {
          id: newSuiteId,
          phaseId: targetPhase.id,
          name: desiredSuiteName,
          title: desiredSuiteName,
          category: catName,
          priority: mapChecklistPriorityToCasePriority(checklistPriority),
          description:
            checklistDescription ||
            `Test suite promoted from checklist "${checklistTitle}" (${catName}).`,
          sourceChecklistId: checklistId,
          sourceChecklistTitle: checklistTitle,
          environment: checklistEnvironment,
          targetRelease: checklistTargetRelease,
          cases: [],
          testCases: [],
        };
        nextSuites.push(targetSuite);
      }

      const addedCasesForSuite = [];

      catItems.forEach((item, itemIdx) => {
        const itemKey = `${checklistId}:${String(item.id)}`;
        const alreadyInSuite = targetSuite.cases.some(
          (tc) =>
            (tc.sourceChecklistId === checklistId &&
              String(tc.sourceChecklistItemId) === String(item.id)) ||
            String(tc.title || '')
              .trim()
              .toLowerCase() ===
              String(item.title || item.text || '')
                .trim()
                .toLowerCase()
        );

        if (existingItemKeys.has(itemKey) || alreadyInSuite) {
          skippedDuplicateItems.push({
            id: item.id,
            title: item.title || item.text,
            category: catName,
            phaseName: targetPhase.name,
          });
          return;
        }

        existingItemKeys.add(itemKey);
        nextCaseNum += 1;
        const caseId = `TC-${String(nextCaseNum).padStart(3, '0')}`;
        const isCompleted = Boolean(item.completed || item.checked);
        const mappedPriority = mapChecklistPriorityToCasePriority(
          item.priority || checklistPriority
        );
        const itemTitle =
          typeof item.title === 'string' && item.title.trim()
            ? item.title.trim()
            : typeof item.text === 'string' && item.text.trim()
            ? item.text.trim()
            : `Checklist Verification #${itemIdx + 1}`;
        const itemNotes =
          typeof item.notes === 'string' && item.notes.trim()
            ? item.notes.trim()
            : '';
        const itemDescription =
          typeof item.description === 'string' && item.description.trim()
            ? item.description.trim()
            : itemNotes
            ? `${itemNotes} (Promoted from checklist "${checklistTitle}")`
            : checklistDescription
            ? `${itemTitle} — ${checklistDescription}`
            : `Promoted from checklist "${checklistTitle}" (${catName}).`;
        const itemPreconditions =
          typeof item.preconditions === 'string' && item.preconditions.trim()
            ? item.preconditions.trim()
            : `Environment: ${checklistEnvironment}${
                checklistTargetRelease
                  ? ` | Target Release: ${checklistTargetRelease}`
                  : ''
              }`;
        const itemExpectedResult =
          typeof item.expectedResult === 'string' && item.expectedResult.trim()
            ? item.expectedResult.trim()
            : `Verification item "${itemTitle}" passes all acceptance criteria.`;

        const newTestCase = {
          id: caseId,
          suiteId: targetSuite.id,
          phaseId: targetPhase.id,
          title: itemTitle,
          description: itemDescription,
          module: catName,
          category: catName,
          priority: mappedPriority,
          severity:
            mappedPriority === 'P0'
              ? 'Critical'
              : mappedPriority === 'P1'
              ? 'Major'
              : mappedPriority === 'P3'
              ? 'Low'
              : 'Medium',
          type: 'Functional',
          automationStatus: 'Manual',
          preconditions: itemPreconditions,
          expectedResult: itemExpectedResult,
          steps: [
            {
              stepNumber: 1,
              action: itemTitle,
              expectedResult:
                itemNotes ||
                `Checklist item "${itemTitle}" verified successfully.`,
            },
          ],
          assignee: item.assignee || 'QA Team',
          environment: checklistEnvironment,
          version: checklistTargetRelease || normProject.version || 'v1.0.0',
          lastStatus: isCompleted ? 'Passed' : 'Untested',
          status: isCompleted ? 'Passed' : 'Not Run',
          notes: itemNotes,
          sourceChecklistId: checklistId,
          sourceChecklistTitle: checklistTitle,
          sourceChecklistItemId: String(item.id),
          sourceChecklistPhaseId: srcPhase.sourcePhaseId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        targetSuite.cases.push(newTestCase);
        targetSuite.testCases = [...targetSuite.cases];
        addedCasesForSuite.push(newTestCase);
        casesToCreate.push(newTestCase);
      });

      const existingSummary = suitesSummaryMap.get(targetSuite.id);
      if (existingSummary) {
        existingSummary.addedCaseCount += addedCasesForSuite.length;
        existingSummary.totalCaseCount = targetSuite.cases.length;
      } else {
        suitesSummaryMap.set(targetSuite.id, {
          id: targetSuite.id,
          name: targetSuite.name || targetSuite.title,
          category: targetSuite.category || catName,
          phaseId: targetSuite.phaseId,
          phaseName: targetPhase.name || targetPhase.title,
          action: suiteAction,
          addedCaseCount: addedCasesForSuite.length,
          totalCaseCount: targetSuite.cases.length,
        });
      }
    }
  });

  let totalCases = 0;
  let passedTests = 0;
  let failedTests = 0;
  let blockedTests = 0;
  let skippedTests = 0;
  let notRunTests = 0;

  nextSuites.forEach((suite) => {
    const suiteCases = extractSuiteTestCases(suite);
    suiteCases.forEach((tc) => {
      totalCases += 1;
      const st = String(tc.lastStatus || tc.status || 'Untested')
        .trim()
        .toLowerCase();
      if (st === 'passed' || st === 'pass' || st === 'completed') {
        passedTests += 1;
      } else if (st === 'failed' || st === 'fail') {
        failedTests += 1;
      } else if (st === 'blocked') {
        blockedTests += 1;
      } else if (st === 'skipped') {
        skippedTests += 1;
      } else {
        notRunTests += 1;
      }
    });
  });

  const executedTests = passedTests + failedTests + blockedTests + skippedTests;
  const passRate =
    executedTests > 0 ? Math.round((passedTests / executedTests) * 100) : 0;

  const suitesSummary = Array.from(suitesSummaryMap.values());
  const createdPhaseCount = phasesSummary.filter(
    (p) => p.action === 'created'
  ).length;
  const reusedPhaseCount = phasesSummary.filter(
    (p) => p.action === 'reused'
  ).length;
  const createdSuiteCount = suitesSummary.filter(
    (s) => s.action === 'created'
  ).length;
  const reusedSuiteCount = suitesSummary.filter(
    (s) => s.action === 'reused'
  ).length;

  const totalChecklistItems = Array.isArray(normChecklist.items)
    ? normChecklist.items.length
    : 0;
  const isEmptyChecklist = totalChecklistItems === 0;

  const alreadyFullyPromoted =
    (!isEmptyChecklist &&
      casesToCreate.length === 0 &&
      skippedDuplicateItems.length > 0) ||
    (isEmptyChecklist &&
      createdPhaseCount === 0 &&
      createdSuiteCount === 0 &&
      (String(normProject.sourceChecklistId || '') === checklistId ||
        existingPhases.some((p) => p.sourceChecklistId === checklistId) ||
        existingSuites.some((s) => s.sourceChecklistId === checklistId)));

  const promotedAt = new Date().toISOString();
  const nextTestPlan = {
    ...existingTestPlan,
    objective:
      existingTestPlan.objective ||
      checklistDescription ||
      `Validate functional, regression, and release readiness coverage for ${normProject.name}.`,
    scope:
      existingTestPlan.scope ||
      `Core workflows, promoted checklist suites (${checklistTitle}), and defect verification.`,
    phases: nextPhases,
  };

  const patchData = {
    testPlan: nextTestPlan,
    phases: nextPhases,
    testSuites: nextSuites,
    sourceChecklistId: checklistId,
    promotedFromChecklistTitle: checklistTitle,
    promotedAt,
    testCaseCount: totalCases,
    executedTests,
    passedTests,
    failedTests,
    blockedTests,
    skippedTests,
    notRunTests,
    passRate,
  };

  return {
    valid: true,
    checklistId,
    checklistTitle,
    checklistCategory,
    checklistPriority,
    checklistEnvironment,
    checklistTargetRelease,
    targetProjectId: String(normProject.id),
    targetProjectName: normProject.name || 'Selected Project',
    isEmptyChecklist,
    alreadyFullyPromoted,
    totalChecklistItems,
    phasesSummary,
    suitesSummary,
    casesToCreate,
    skippedDuplicateItems,
    stats: {
      createdPhaseCount,
      reusedPhaseCount,
      totalPhaseCount: phasesSummary.length,
      createdSuiteCount,
      reusedSuiteCount,
      totalSuiteCount: suitesSummary.length,
      createdCaseCount: casesToCreate.length,
      passedCaseCount: casesToCreate.filter(
        (c) => c.lastStatus === 'Passed'
      ).length,
      untestedCaseCount: casesToCreate.filter(
        (c) => c.lastStatus !== 'Passed'
      ).length,
      skippedDuplicateCount: skippedDuplicateItems.length,
      projectTotalCasesBefore: existingSuites.reduce(
        (sum, s) => sum + extractSuiteTestCases(s).length,
        0
      ),
      projectTotalCasesAfter: totalCases,
      projectPassRateAfter: passRate,
    },
    patchData,
  };
}
