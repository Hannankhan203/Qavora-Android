import React from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, monoFontFamily } from '../../theme/theme';
import VectorIcon from '../VectorIcon';
import styles from './checklistsStyles';

export default function ChecklistPromoteModal({
  promoteModalVisible,
  closePromoteModal,
  isPromoting,
  promoteSourceChecklist,
  getPriorityBadgeColors,
  promoteSuccessResult,
  handleOpenPromotedProjectTestCases,
  availableProjects,
  onBackToOverview,
  promoteTargetProjectId,
  handleSelectPromoteProject,
  promotionPreview,
  isLoadingPromotePreview,
  promoteProgressText,
  promoteError,
  handleConfirmPromoteChecklist,
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={promoteModalVisible}
      transparent
      animationType="fade"
      onRequestClose={closePromoteModal}
    >
      <View
        accessibilityViewIsModal={true}
        style={[
          styles.modalBackdrop,
          {
            backgroundColor: colors.overlay,
            paddingTop: Math.max(16, insets.top),
            paddingBottom: Math.max(16, insets.bottom + 8),
          },
        ]}
      >
        <View
          style={[
            styles.modalCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={styles.promoteModalHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.sectionKicker,
                  { color: colors.primary, fontFamily: monoFontFamily },
                ]}
              >
                CHECKLIST-TO-PROJECT PROMOTION
              </Text>
              <Text
                accessibilityRole="header"
                style={[
                  styles.modalTitle,
                  { color: colors.text, marginBottom: 4 },
                ]}
              >
                Promote Checklist to Project
              </Text>
            </View>
            <Pressable
              onPress={closePromoteModal}
              disabled={isPromoting}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              accessibilityRole="button"
              accessibilityLabel="Close promote checklist modal"
              style={[
                styles.iconBtn,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                },
              ]}
            >
              <VectorIcon name="close" size={16} color={colors.textSecondary} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.modalScrollArea}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Source Checklist Summary Box */}
            {promoteSourceChecklist ? (
              <View
                style={[
                  styles.promoteChecklistSummaryBox,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                  },
                ]}
              >
                <View style={styles.badgeRow}>
                  <View
                    style={[
                      styles.badge,
                      { backgroundColor: colors.surfaceAccent },
                    ]}
                  >
                    <Text
                      style={[styles.badgeText, { color: colors.primary }]}
                    >
                      {promoteSourceChecklist.category || 'General QA'}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.badge,
                      {
                        backgroundColor: getPriorityBadgeColors(
                          promoteSourceChecklist.priority
                        ).bg,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.badgeText,
                        {
                          color: getPriorityBadgeColors(
                            promoteSourceChecklist.priority
                          ).fg,
                        },
                      ]}
                    >
                      {promoteSourceChecklist.priority || 'Medium'} Priority
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.badge,
                      { backgroundColor: colors.surfaceMuted },
                    ]}
                  >
                    <Text
                      style={[
                        styles.badgeText,
                        {
                          color: colors.textSecondary,
                          fontFamily: monoFontFamily,
                        },
                      ]}
                    >
                      {promoteSourceChecklist.completedItems || 0}/
                      {promoteSourceChecklist.totalItems || 0} Done
                    </Text>
                  </View>
                </View>

                <Text
                  style={[
                    styles.cardTitle,
                    { color: colors.text, marginTop: 6, marginBottom: 2 },
                  ]}
                >
                  {promoteSourceChecklist.title}
                </Text>
                {promoteSourceChecklist.description ? (
                  <Text
                    numberOfLines={2}
                    style={[
                      styles.cardDescription,
                      { color: colors.textSecondary, marginBottom: 4 },
                    ]}
                  >
                    {promoteSourceChecklist.description}
                  </Text>
                ) : null}
                <Text
                  style={[
                    styles.metaLine,
                    {
                      color: colors.textMuted,
                      fontFamily: monoFontFamily,
                      marginBottom: 0,
                    },
                  ]}
                >
                  Env: {promoteSourceChecklist.environment || 'Staging'}
                  {promoteSourceChecklist.targetRelease
                    ? ` · Release: ${promoteSourceChecklist.targetRelease}`
                    : ''}{' '}
                  · Original checklist is preserved unchanged
                </Text>
              </View>
            ) : null}

            {/* SUCCESS STATE */}
            {promoteSuccessResult ? (
              <View
                style={[
                  styles.promoteSuccessCard,
                  {
                    backgroundColor: colors.successSoft,
                    borderColor: colors.success,
                  },
                ]}
              >
                <View style={styles.promoteSuccessHeaderRow}>
                  <VectorIcon
                    name="check-circle"
                    size={20}
                    color={colors.success}
                  />
                  <Text
                    style={[
                      styles.statusBannerTitle,
                      { color: colors.success, fontSize: 15, flex: 1 },
                    ]}
                  >
                    {promoteSuccessResult.queuedOffline
                      ? 'Promotion Queued for Offline Sync'
                      : 'Checklist Promoted Successfully'}
                  </Text>
                </View>

                <Text
                  style={[
                    styles.statusBannerText,
                    { color: colors.text, marginTop: 6, marginBottom: 10 },
                  ]}
                >
                  Promoted{' '}
                  <Text style={{ fontWeight: '700' }}>
                    {promoteSourceChecklist?.title}
                  </Text>{' '}
                  into project{' '}
                  <Text style={{ fontWeight: '700' }}>
                    {promoteSuccessResult.project?.name}
                  </Text>
                  . The original checklist remains intact.
                </Text>

                <View style={styles.promoteStatsGrid}>
                  <View
                    style={[
                      styles.promoteStatBox,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.promoteStatValue,
                        { color: colors.primary, fontFamily: monoFontFamily },
                      ]}
                    >
                      {promoteSuccessResult.summary?.totalPhaseCount || 1}
                    </Text>
                    <Text
                      style={[
                        styles.promoteStatLabel,
                        { color: colors.textSecondary },
                      ]}
                    >
                      Phases Mapped
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.promoteStatBox,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.promoteStatValue,
                        { color: colors.primary, fontFamily: monoFontFamily },
                      ]}
                    >
                      {promoteSuccessResult.summary?.totalSuiteCount || 1}
                    </Text>
                    <Text
                      style={[
                        styles.promoteStatLabel,
                        { color: colors.textSecondary },
                      ]}
                    >
                      Test Suites
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.promoteStatBox,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.promoteStatValue,
                        { color: colors.success, fontFamily: monoFontFamily },
                      ]}
                    >
                      +{promoteSuccessResult.summary?.createdCaseCount || 0}
                    </Text>
                    <Text
                      style={[
                        styles.promoteStatLabel,
                        { color: colors.textSecondary },
                      ]}
                    >
                      Test Cases Added
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.promoteStatBox,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.promoteStatValue,
                        { color: colors.text, fontFamily: monoFontFamily },
                      ]}
                    >
                      {promoteSuccessResult.summary?.projectTotalCasesAfter ??
                        promoteSuccessResult.project?.testCaseCount ??
                        0}
                    </Text>
                    <Text
                      style={[
                        styles.promoteStatLabel,
                        { color: colors.textSecondary },
                      ]}
                    >
                      Project Total Cases
                    </Text>
                  </View>
                </View>

                <View style={[styles.modalActionsRow, { marginTop: 14 }]}>
                  <Pressable
                    onPress={closePromoteModal}
                    accessibilityRole="button"
                    accessibilityLabel="Done"
                    style={[
                      styles.modalCancelBtn,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.borderStrong,
                      },
                    ]}
                  >
                    <Text
                      style={[styles.modalCancelText, { color: colors.text }]}
                    >
                      Done
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={handleOpenPromotedProjectTestCases}
                    accessibilityRole="button"
                    accessibilityLabel="Open promoted project test cases"
                    style={[
                      styles.modalConfirmBtn,
                      {
                        backgroundColor: colors.primary,
                        flexDirection: 'row',
                        gap: 6,
                      },
                    ]}
                  >
                    <VectorIcon
                      name="layers"
                      size={14}
                      color={colors.textOnPrimary}
                    />
                    <Text
                      style={[
                        styles.modalConfirmText,
                        { color: colors.textOnPrimary },
                      ]}
                    >
                      Open Project Test Cases
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <>
                {/* Destination Project Selector */}
                <Text
                  style={[
                    styles.fieldLabel,
                    { color: colors.textSecondary, marginTop: 4 },
                  ]}
                >
                  1. Select Destination QA Project *
                </Text>

                {availableProjects.length === 0 ? (
                  <View
                    style={[
                      styles.errorAlert,
                      {
                        backgroundColor: colors.warningSoft,
                        borderColor: colors.warning,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.errorAlertText,
                        { color: colors.warning, marginBottom: 6 },
                      ]}
                    >
                      No existing QA Projects found in your workspace. Create
                      a project first to promote checklists into it.
                    </Text>
                    {onBackToOverview ? (
                      <Pressable
                        onPress={() => {
                          closePromoteModal();
                          onBackToOverview();
                        }}
                        accessibilityRole="button"
                        accessibilityLabel="Go to Projects"
                        style={[
                          styles.secondaryHeaderBtn,
                          {
                            alignSelf: 'flex-start',
                            backgroundColor: colors.surface,
                            borderColor: colors.warning,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.secondaryHeaderBtnText,
                            { color: colors.warning },
                          ]}
                        >
                          Go to Projects
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : (
                  <View
                    accessibilityRole="radiogroup"
                    style={styles.promoteProjectsList}
                  >
                    {availableProjects.map((proj) => {
                      const pId = String(proj.id || proj._id);
                      const isSelected =
                        String(promoteTargetProjectId) === pId;
                      const wasPromotedHere =
                        promoteSourceChecklist &&
                        (String(proj.sourceChecklistId || '') ===
                          String(promoteSourceChecklist.id) ||
                          (Array.isArray(proj.testSuites) &&
                            proj.testSuites.some(
                              (s) =>
                                String(s.sourceChecklistId || '') ===
                                String(promoteSourceChecklist.id)
                            )));

                      return (
                        <Pressable
                          key={pId}
                          onPress={() => handleSelectPromoteProject(pId)}
                          disabled={isPromoting}
                          accessibilityRole="radio"
                          accessibilityState={{
                            selected: isSelected,
                            checked: isSelected,
                            disabled: Boolean(isPromoting),
                          }}
                          accessibilityLabel={`Select destination project ${proj.name}`}
                          style={[
                            styles.promoteProjectOption,
                            {
                              backgroundColor: isSelected
                                ? colors.surfaceAccent
                                : colors.background,
                              borderColor: isSelected
                                ? colors.primary
                                : colors.border,
                            },
                          ]}
                        >
                          <View
                            style={[
                              styles.promoteRadioOuter,
                              {
                                borderColor: isSelected
                                  ? colors.primary
                                  : colors.borderStrong,
                              },
                            ]}
                          >
                            {isSelected ? (
                              <View
                                style={[
                                  styles.promoteRadioInner,
                                  { backgroundColor: colors.primary },
                                ]}
                              />
                            ) : null}
                          </View>

                          <View style={{ flex: 1 }}>
                            <View style={styles.promoteProjectOptionTitleRow}>
                              <Text
                                style={[
                                  styles.promoteProjectOptionName,
                                  {
                                    color: isSelected
                                      ? colors.primary
                                      : colors.text,
                                  },
                                ]}
                              >
                                {proj.name}
                              </Text>
                              {wasPromotedHere ? (
                                <View
                                  style={[
                                    styles.badge,
                                    { backgroundColor: colors.infoSoft },
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.badgeText,
                                      { color: colors.info },
                                    ]}
                                  >
                                    Promoted
                                  </Text>
                                </View>
                              ) : null}
                            </View>
                            <Text
                              style={[
                                styles.promoteProjectOptionMeta,
                                {
                                  color: colors.textSecondary,
                                  fontFamily: monoFontFamily,
                                },
                              ]}
                            >
                              {proj.environment || 'Staging'} ·{' '}
                              {proj.version || 'v1.0.0'} ·{' '}
                              {proj.testCaseCount || 0} existing test cases
                            </Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                )}

                {/* Mapping Preview Card */}
                {promotionPreview && promotionPreview.valid ? (
                  <View
                    style={[
                      styles.promotePreviewBox,
                      {
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <View style={styles.promotePreviewHeaderRow}>
                      <Text
                        style={[
                          styles.fieldLabel,
                          { color: colors.text, marginBottom: 0 },
                        ]}
                      >
                        2. Promotion Mapping Preview →{' '}
                        {promotionPreview.targetProjectName}
                      </Text>
                      {isLoadingPromotePreview ? (
                        <ActivityIndicator
                          size="small"
                          color={colors.primary}
                        />
                      ) : null}
                    </View>

                    {/* KPI Preview Grid */}
                    <View style={styles.promoteStatsGrid}>
                      <View
                        style={[
                          styles.promoteStatBox,
                          {
                            backgroundColor: colors.surface,
                            borderColor: colors.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.promoteStatValue,
                            {
                              color: colors.primary,
                              fontFamily: monoFontFamily,
                            },
                          ]}
                        >
                          {promotionPreview.stats.totalPhaseCount}
                        </Text>
                        <Text
                          style={[
                            styles.promoteStatLabel,
                            { color: colors.textSecondary },
                          ]}
                        >
                          Phase
                          {promotionPreview.stats.totalPhaseCount === 1
                            ? ''
                            : 's'}{' '}
                          ({promotionPreview.stats.createdPhaseCount} new)
                        </Text>
                      </View>

                      <View
                        style={[
                          styles.promoteStatBox,
                          {
                            backgroundColor: colors.surface,
                            borderColor: colors.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.promoteStatValue,
                            {
                              color: colors.primary,
                              fontFamily: monoFontFamily,
                            },
                          ]}
                        >
                          {promotionPreview.stats.totalSuiteCount}
                        </Text>
                        <Text
                          style={[
                            styles.promoteStatLabel,
                            { color: colors.textSecondary },
                          ]}
                        >
                          Suite
                          {promotionPreview.stats.totalSuiteCount === 1
                            ? ''
                            : 's'}{' '}
                          ({promotionPreview.stats.createdSuiteCount} new)
                        </Text>
                      </View>

                      <View
                        style={[
                          styles.promoteStatBox,
                          {
                            backgroundColor: colors.surface,
                            borderColor: colors.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.promoteStatValue,
                            {
                              color: colors.success,
                              fontFamily: monoFontFamily,
                            },
                          ]}
                        >
                          +{promotionPreview.stats.createdCaseCount}
                        </Text>
                        <Text
                          style={[
                            styles.promoteStatLabel,
                            { color: colors.textSecondary },
                          ]}
                        >
                          New Cases ({promotionPreview.stats.passedCaseCount}{' '}
                          Passed · {promotionPreview.stats.untestedCaseCount}{' '}
                          Untested)
                        </Text>
                      </View>
                    </View>

                    {/* Phase & Suite Structure Breakdown */}
                    <View style={styles.promoteMappingList}>
                      <Text
                        style={[
                          styles.promoteSubheading,
                          { color: colors.textSecondary },
                        ]}
                      >
                        Checklist Phases → Project Testing Phases:
                      </Text>
                      {promotionPreview.phasesSummary.map((ph) => (
                        <View
                          key={ph.id}
                          style={[
                            styles.promoteMappingItem,
                            {
                              backgroundColor: colors.surface,
                              borderColor: colors.border,
                            },
                          ]}
                        >
                          <VectorIcon
                            name="flag"
                            size={13}
                            color={colors.primary}
                          />
                          <Text
                            style={[
                              styles.promoteMappingItemText,
                              { color: colors.text, flex: 1 },
                            ]}
                          >
                            {ph.name}
                          </Text>
                          <Text
                            style={[
                              styles.promoteMappingBadge,
                              {
                                color:
                                  ph.action === 'created'
                                    ? colors.success
                                    : colors.info,
                                fontFamily: monoFontFamily,
                              },
                            ]}
                          >
                            {ph.action === 'created'
                              ? '+ New Phase'
                              : 'Reused Phase'}
                          </Text>
                        </View>
                      ))}

                      <Text
                        style={[
                          styles.promoteSubheading,
                          { color: colors.textSecondary, marginTop: 6 },
                        ]}
                      >
                        Checklist Categories → Test Suites & Test Cases:
                      </Text>
                      {promotionPreview.suitesSummary.map((st) => (
                        <View
                          key={st.id}
                          style={[
                            styles.promoteMappingItem,
                            {
                              backgroundColor: colors.surface,
                              borderColor: colors.border,
                            },
                          ]}
                        >
                          <VectorIcon
                            name="folder"
                            size={13}
                            color={colors.primary}
                          />
                          <View style={{ flex: 1 }}>
                            <Text
                              style={[
                                styles.promoteMappingItemText,
                                { color: colors.text },
                              ]}
                            >
                              {st.name}
                            </Text>
                            <Text
                              style={[
                                styles.promoteMappingSubtext,
                                {
                                  color: colors.textMuted,
                                  fontFamily: monoFontFamily,
                                },
                              ]}
                            >
                              Category: {st.category} · +{st.addedCaseCount}{' '}
                              test case{st.addedCaseCount === 1 ? '' : 's'}
                            </Text>
                          </View>
                          <Text
                            style={[
                              styles.promoteMappingBadge,
                              {
                                color:
                                  st.action === 'created'
                                    ? colors.success
                                    : colors.info,
                                fontFamily: monoFontFamily,
                              },
                            ]}
                          >
                            {st.action === 'created'
                              ? '+ New Suite'
                              : 'Update Suite'}
                          </Text>
                        </View>
                      ))}
                    </View>

                    {/* Empty Checklist Notice */}
                    {promotionPreview.isEmptyChecklist ? (
                      <View
                        style={[
                          styles.promoteInfoBanner,
                          {
                            backgroundColor: colors.infoSoft,
                            borderColor: colors.info,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.promoteInfoBannerText,
                            { color: colors.info },
                          ]}
                        >
                          This checklist currently has 0 items. Promoting it
                          will create its testing phase and category test
                          suite shell in &ldquo;
                          {promotionPreview.targetProjectName}&rdquo; without
                          adding test cases.
                        </Text>
                      </View>
                    ) : null}

                    {/* Already Promoted / Duplicate Prevention Notice */}
                    {promotionPreview.alreadyFullyPromoted ? (
                      <View
                        style={[
                          styles.promoteInfoBanner,
                          {
                            backgroundColor: colors.warningSoft,
                            borderColor: colors.warning,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.promoteInfoBannerText,
                            { color: colors.warning },
                          ]}
                        >
                          All verification items from this checklist have
                          already been promoted to &ldquo;
                          {promotionPreview.targetProjectName}&rdquo;.
                          Duplicate promotion is blocked to prevent duplicate
                          test cases. Select a different project or add new
                          items to this checklist first.
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}

                {/* Progress Indicator */}
                {isPromoting ? (
                  <View
                    style={[
                      styles.promoteProgressBanner,
                      {
                        backgroundColor: colors.surfaceAccent,
                        borderColor: colors.primary,
                      },
                    ]}
                  >
                    <ActivityIndicator
                      size="small"
                      color={colors.primary}
                    />
                    <Text
                      style={[
                        styles.promoteProgressText,
                        { color: colors.primary },
                      ]}
                    >
                      {promoteProgressText ||
                        'Promoting checklist to project...'}
                    </Text>
                  </View>
                ) : null}

                {/* Error Banner with Retry Action */}
                {promoteError ? (
                  <View
                    style={[
                      styles.errorAlert,
                      {
                        backgroundColor: colors.dangerSoft,
                        borderColor: colors.danger,
                        marginTop: 8,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.errorAlertText,
                        { color: colors.danger, marginBottom: 8 },
                      ]}
                    >
                      {promoteError}
                    </Text>
                    {!promotionPreview?.alreadyFullyPromoted ? (
                      <Pressable
                        onPress={handleConfirmPromoteChecklist}
                        disabled={isPromoting}
                        accessibilityRole="button"
                        accessibilityState={{
                          disabled: Boolean(isPromoting),
                        }}
                        accessibilityLabel="Retry Promotion"
                        style={[
                          styles.retryBtn,
                          {
                            alignSelf: 'flex-start',
                            backgroundColor: colors.surface,
                            borderColor: colors.danger,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.retryBtnText,
                            { color: colors.danger },
                          ]}
                        >
                          Retry Promotion
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </>
            )}
          </ScrollView>

          {!promoteSuccessResult ? (
            <View style={styles.modalActionsRow}>
              <Pressable
                onPress={closePromoteModal}
                disabled={isPromoting}
                accessibilityRole="button"
                accessibilityState={{ disabled: Boolean(isPromoting) }}
                accessibilityLabel="Cancel promoting checklist"
                style={[
                  styles.modalCancelBtn,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.borderStrong,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.modalCancelText,
                    { color: colors.text },
                  ]}
                >
                  Cancel
                </Text>
              </Pressable>

              <Pressable
                onPress={handleConfirmPromoteChecklist}
                disabled={
                  isPromoting ||
                  availableProjects.length === 0 ||
                  !promoteTargetProjectId ||
                  Boolean(
                    promotionPreview &&
                      promotionPreview.alreadyFullyPromoted
                  )
                }
                accessibilityRole="button"
                accessibilityState={{
                  disabled: Boolean(
                    isPromoting ||
                      availableProjects.length === 0 ||
                      !promoteTargetProjectId ||
                      (promotionPreview &&
                        promotionPreview.alreadyFullyPromoted)
                  ),
                }}
                accessibilityLabel={
                  isPromoting
                    ? 'Promoting checklist to project'
                    : promotionPreview?.alreadyFullyPromoted
                    ? 'Checklist already promoted'
                    : 'Confirm and Promote checklist'
                }
                style={[
                  styles.modalConfirmBtn,
                  {
                    backgroundColor: colors.primary,
                    flexDirection: 'row',
                    gap: 6,
                    opacity:
                      isPromoting ||
                      availableProjects.length === 0 ||
                      !promoteTargetProjectId ||
                      Boolean(
                        promotionPreview &&
                          promotionPreview.alreadyFullyPromoted
                      )
                        ? 0.55
                        : 1,
                  },
                ]}
              >
                <VectorIcon
                  name="layers"
                  size={14}
                  color={colors.textOnPrimary}
                />
                <Text
                  style={[
                    styles.modalConfirmText,
                    { color: colors.textOnPrimary },
                  ]}
                >
                  {isPromoting
                    ? 'Promoting...'
                    : promotionPreview?.alreadyFullyPromoted
                    ? 'Already Promoted'
                    : 'Confirm & Promote'}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
