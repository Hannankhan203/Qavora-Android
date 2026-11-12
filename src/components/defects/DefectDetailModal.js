import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Modal,
} from 'react-native';
import VectorIcon from '../VectorIcon';
import { monoFontFamily } from '../../theme/theme';
import { DEFECT_STATUSES } from '../../data/initialData';
import { validateDefectExternalUrl } from './defectUrlUtils';
import styles from './defectsStyles';

export default function DefectDetailModal({
  theme,
  viewingDefect,
  closeDetailModal,
  getSeverityBadge,
  getPriorityBadge,
  getStatusBadge,
  isUpdatingStatus,
  handleQuickStatusChange,
  handleOpenExternalUrl,
  testCases,
  testRuns,
  setSelectedTestCaseId,
  setSelectedTestRunId,
  setActiveTab,
  setDefectPendingDelete,
  openEditDefectForm,
}) {
  return (
    <Modal
      visible={!!viewingDefect}
      animationType="slide"
      transparent
      onRequestClose={closeDetailModal}
    >
      <View
        accessibilityViewIsModal={true}
        style={[styles.modalOverlay, { backgroundColor: theme.overlay }]}
      >
        <View
          style={[
            styles.modalSheet,
            {
              backgroundColor: theme.surface,
              borderColor: theme.border,
            },
          ]}
        >
          {viewingDefect && (
            <>
              <View
                style={[
                  styles.modalHeader,
                  { borderBottomColor: theme.border },
                ]}
              >
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <View style={styles.detailHeaderTags}>
                    <Text
                      style={[
                        styles.detailBugId,
                        { color: theme.primary, fontFamily: monoFontFamily },
                      ]}
                    >
                      {viewingDefect.defectId || viewingDefect.id}
                    </Text>
                    <View
                      style={[
                        styles.badge,
                        {
                          backgroundColor: getSeverityBadge(
                            viewingDefect.severity
                          ).bg,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.badgeText,
                          {
                            color: getSeverityBadge(viewingDefect.severity)
                              .color,
                          },
                        ]}
                      >
                        Sev: {viewingDefect.severity}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.badge,
                        {
                          backgroundColor: getPriorityBadge(
                            viewingDefect.priority ||
                              viewingDefect.severity ||
                              'High'
                          ).bg,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.badgeText,
                          {
                            color: getPriorityBadge(
                              viewingDefect.priority ||
                                viewingDefect.severity ||
                                'High'
                            ).color,
                          },
                        ]}
                      >
                        Pri:{' '}
                        {viewingDefect.priority ||
                          viewingDefect.severity ||
                          'High'}
                      </Text>
                    </View>
                  </View>
                  <Text
                    accessibilityRole="header"
                    style={[styles.modalTitle, { color: theme.text }]}
                    numberOfLines={2}
                  >
                    {viewingDefect.title}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={closeDetailModal}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel="Close defect details"
                  style={[
                    styles.closeBtn,
                    { backgroundColor: theme.surfaceMuted },
                  ]}
                >
                  <VectorIcon
                    name="close"
                    size={16}
                    color={theme.textSecondary}
                  />
                </TouchableOpacity>
              </View>

              <ScrollView
                style={styles.modalScrollArea}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.modalBody}
              >
                <Text
                  style={[
                    styles.sectionLabel,
                    { color: theme.textSecondary },
                  ]}
                >
                  DEFECT WORKFLOW STATUS
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ marginBottom: 16 }}
                >
                  {DEFECT_STATUSES.map((st) => {
                    const active = viewingDefect.status === st;
                    const stMeta = getStatusBadge(st);
                    return (
                      <TouchableOpacity
                        key={st}
                        onPress={() =>
                          handleQuickStatusChange(viewingDefect, st)
                        }
                        disabled={isUpdatingStatus}
                        hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                        accessibilityRole="button"
                        accessibilityState={{
                          selected: active,
                          disabled: Boolean(isUpdatingStatus),
                        }}
                        accessibilityLabel={`Set defect status to ${st}`}
                        style={[
                          styles.statusStepBtn,
                          {
                            backgroundColor: active
                              ? stMeta.bg
                              : theme.surfaceMuted,
                            borderColor: active
                              ? stMeta.color
                              : theme.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusStepText,
                            {
                              color: active
                                ? stMeta.color
                                : theme.textSecondary,
                            },
                          ]}
                        >
                          {st}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                {viewingDefect.description ? (
                  <>
                    <Text
                      style={[
                        styles.sectionLabel,
                        { color: theme.textSecondary },
                      ]}
                    >
                      DESCRIPTION / SUMMARY
                    </Text>
                    <View
                      style={[
                        styles.detailBlock,
                        {
                          backgroundColor: theme.surfaceMuted,
                          borderColor: theme.border,
                        },
                      ]}
                    >
                      <Text
                        style={[styles.detailText, { color: theme.text }]}
                      >
                        {viewingDefect.description}
                      </Text>
                    </View>
                  </>
                ) : null}

                <Text
                  style={[
                    styles.sectionLabel,
                    { color: theme.textSecondary },
                  ]}
                >
                  STEPS TO REPRODUCE
                </Text>
                <View
                  style={[
                    styles.detailBlock,
                    {
                      backgroundColor: theme.surfaceMuted,
                      borderColor: theme.border,
                    },
                  ]}
                >
                  <Text style={[styles.detailText, { color: theme.text }]}>
                    {viewingDefect.reproductionSteps ||
                      viewingDefect.steps ||
                      'No reproduction steps recorded.'}
                  </Text>
                </View>

                <View style={styles.comparisonGrid}>
                  <View
                    style={[
                      styles.comparisonCard,
                      {
                        backgroundColor: theme.successSoft,
                        borderColor: theme.success,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.comparisonHeader,
                        { color: theme.success },
                      ]}
                    >
                      EXPECTED RESULT
                    </Text>
                    <Text
                      style={[styles.comparisonBody, { color: theme.text }]}
                    >
                      {viewingDefect.expectedResult}
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.comparisonCard,
                      {
                        backgroundColor: theme.dangerSoft,
                        borderColor: theme.danger,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.comparisonHeader,
                        { color: theme.danger },
                      ]}
                    >
                      ACTUAL RESULT
                    </Text>
                    <Text
                      style={[styles.comparisonBody, { color: theme.text }]}
                    >
                      {viewingDefect.actualResult}
                    </Text>
                  </View>
                </View>

                <Text
                  style={[
                    styles.sectionLabel,
                    { color: theme.textSecondary, marginTop: 14 },
                  ]}
                >
                  ENVIRONMENT & BUILD CONTEXT
                </Text>
                <View
                  style={[
                    styles.detailBlock,
                    {
                      backgroundColor: theme.surfaceMuted,
                      borderColor: theme.border,
                    },
                  ]}
                >
                  <Text style={[styles.detailText, { color: theme.text }]}>
                    {viewingDefect.environment || 'Android Device'}
                  </Text>
                  {(() => {
                    const rawExtUrl =
                      typeof viewingDefect.externalUrl === 'string'
                        ? viewingDefect.externalUrl.trim()
                        : '';
                    if (!rawExtUrl) {
                      return null;
                    }
                    const urlMeta = validateDefectExternalUrl(rawExtUrl);
                    if (urlMeta.isValid && urlMeta.normalizedUrl) {
                      return (
                        <TouchableOpacity
                          activeOpacity={0.75}
                          accessibilityRole="link"
                          accessibilityLabel={`Open external issue ${urlMeta.normalizedUrl}`}
                          accessibilityHint="Opens the external issue URL in your browser"
                          onPress={() =>
                            handleOpenExternalUrl(urlMeta.normalizedUrl)
                          }
                          style={[
                            styles.externalUrlLinkBtn,
                            {
                              backgroundColor: theme.primarySoft,
                              borderColor: theme.primary,
                            },
                          ]}
                        >
                          <VectorIcon
                            name="globe"
                            size={14}
                            color={theme.primary}
                            style={styles.externalUrlIcon}
                          />
                          <View style={styles.externalUrlContentWrap}>
                            <Text
                              style={[
                                styles.externalUrlLabel,
                                { color: theme.textSecondary },
                              ]}
                            >
                              EXTERNAL ISSUE LINK (TAP TO OPEN)
                            </Text>
                            <Text
                              selectable
                              style={[
                                styles.externalUrlText,
                                { color: theme.primary },
                              ]}
                            >
                              {urlMeta.normalizedUrl}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      );
                    }
                    return (
                      <View
                        style={[
                          styles.externalUrlInvalidBox,
                          {
                            backgroundColor: theme.surface,
                            borderColor: theme.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.externalUrlInvalidLabel,
                            { color: theme.textMuted },
                          ]}
                        >
                          External Issue (Unsupported / Invalid URL):
                        </Text>
                        <Text
                          selectable
                          style={[
                            styles.externalUrlInvalidText,
                            { color: theme.textSecondary },
                          ]}
                        >
                          {rawExtUrl}
                        </Text>
                      </View>
                    );
                  })()}
                </View>

                {/* Bidirectional Execution & Test Case Traceability */}
                {(() => {
                  const linkedCase = testCases.find(
                    (c) => c.id === viewingDefect.linkedTestCaseId
                  );
                  const linkedRun = testRuns.find(
                    (r) => r.id === viewingDefect.linkedTestRunId
                  );
                  return (
                    <View
                      style={[
                        styles.traceabilityBox,
                        {
                          backgroundColor: theme.surfaceMuted,
                          borderColor: theme.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.sectionLabel,
                          { color: theme.textSecondary, marginBottom: 8 },
                        ]}
                      >
                        LINKED TEST CASE & EXECUTION CONTEXT
                      </Text>

                      {linkedCase || viewingDefect.linkedTestCaseId ? (
                        <TouchableOpacity
                          accessibilityRole="button"
                          accessibilityLabel={`Open linked test case ${
                            linkedCase?.id || viewingDefect.linkedTestCaseId
                          }`}
                          style={[
                            styles.traceLinkBtn,
                            {
                              backgroundColor: theme.primarySoft,
                              borderColor: theme.primary,
                            },
                          ]}
                          onPress={() => {
                            if (linkedCase) {
                              setSelectedTestCaseId(linkedCase.id);
                            }
                            closeDetailModal();
                            setActiveTab('testcases');
                          }}
                        >
                          <VectorIcon
                            name="tag"
                            size={14}
                            color={theme.primary}
                          />
                          <View style={{ flex: 1 }}>
                            <Text
                              style={[
                                styles.traceLinkTitle,
                                { color: theme.primary },
                              ]}
                            >
                              Test Case:{' '}
                              {linkedCase?.id ||
                                viewingDefect.linkedTestCaseId}
                            </Text>
                            <Text
                              style={[
                                styles.traceLinkSub,
                                { color: theme.text },
                              ]}
                              numberOfLines={1}
                            >
                              {linkedCase?.title ||
                                viewingDefect.linkedCaseTitle ||
                                'View Linked Test Case'}
                            </Text>
                          </View>
                          <VectorIcon
                            name="chevron-right"
                            size={15}
                            color={theme.primary}
                          />
                        </TouchableOpacity>
                      ) : (
                        <Text
                          style={[
                            styles.unlinkedHint,
                            { color: theme.textMuted },
                          ]}
                        >
                          Not linked to a specific test case.
                        </Text>
                      )}

                      {linkedRun || viewingDefect.linkedTestRunId ? (
                        <TouchableOpacity
                          accessibilityRole="button"
                          accessibilityLabel={`Open linked test run ${
                            linkedRun?.id || viewingDefect.linkedTestRunId
                          }`}
                          style={[
                            styles.traceLinkBtn,
                            {
                              backgroundColor: theme.infoSoft,
                              borderColor: theme.info,
                              marginTop: 8,
                            },
                          ]}
                          onPress={() => {
                            if (linkedRun) {
                              setSelectedTestRunId(linkedRun.id);
                            }
                            closeDetailModal();
                            setActiveTab('testruns');
                          }}
                        >
                          <VectorIcon
                            name="layers"
                            size={14}
                            color={theme.info}
                          />
                          <View style={{ flex: 1 }}>
                            <Text
                              style={[
                                styles.traceLinkTitle,
                                { color: theme.info },
                              ]}
                            >
                              Test Run:{' '}
                              {linkedRun?.id || viewingDefect.linkedTestRunId}
                            </Text>
                            <Text
                              style={[
                                styles.traceLinkSub,
                                { color: theme.text },
                              ]}
                              numberOfLines={1}
                            >
                              {linkedRun
                                ? `${linkedRun.name} (${linkedRun.status})`
                                : 'Open Test Runs'}
                            </Text>
                          </View>
                          <VectorIcon
                            name="chevron-right"
                            size={15}
                            color={theme.info}
                          />
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  );
                })()}
              </ScrollView>

              {/* Detail Modal Footer Actions */}
              <View
                style={[
                  styles.modalFooter,
                  { borderTopColor: theme.border },
                ]}
              >
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={`Delete defect ${
                    viewingDefect.defectId || viewingDefect.id
                  }`}
                  style={[
                    styles.deleteModalBtn,
                    {
                      backgroundColor: theme.dangerSoft,
                      borderColor: theme.danger,
                    },
                  ]}
                  onPress={() => setDefectPendingDelete(viewingDefect)}
                >
                  <VectorIcon name="trash" size={15} color={theme.danger} />
                  <Text
                    style={[
                      styles.deleteModalBtnText,
                      { color: theme.danger },
                    ]}
                  >
                    Delete
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={`Edit defect ${
                    viewingDefect.defectId || viewingDefect.id
                  }`}
                  style={[
                    styles.saveBtn,
                    { backgroundColor: theme.primary },
                  ]}
                  onPress={() => openEditDefectForm(viewingDefect)}
                >
                  <VectorIcon name="edit" size={15} color="#FFFFFF" />
                  <Text style={styles.saveBtnText}>Edit Defect Details</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}
