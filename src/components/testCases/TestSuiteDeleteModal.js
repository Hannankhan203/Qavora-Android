import React from 'react';
import {
  Text,
  View,
  ScrollView,
  Pressable,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { useTheme } from '../../theme/theme';
import VectorIcon from '../VectorIcon';
import styles from './testCasesStyles';

export default function TestSuiteDeleteModal({
  deletingSuite,
  setDeletingSuite,
  isDeletingSuite,
  suiteStatsMap,
  suites,
  suiteDeleteMode,
  setSuiteDeleteMode,
  suiteDeleteTargetId,
  setSuiteDeleteTargetId,
  handleConfirmDeleteSuite,
  deleteSuiteError,
  onCancelDeleteSuite,
}) {
  const { colors } = useTheme();
  const handleClose = () => {
    if (isDeletingSuite) return;
    if (typeof onCancelDeleteSuite === 'function') {
      onCancelDeleteSuite();
    } else if (typeof setDeletingSuite === 'function') {
      setDeletingSuite(null);
    }
  };

  return (
    <Modal
      visible={!!deletingSuite}
      animationType="fade"
      transparent
      onRequestClose={handleClose}
    >
      <View
        accessibilityViewIsModal={true}
        style={[
          styles.centeredModalOverlay,
          { backgroundColor: colors.overlay },
        ]}
      >
        <View
          style={[
            styles.smallModalCard,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          {deletingSuite && (
            <>
              <Text
                accessibilityRole="header"
                style={[
                  styles.smallModalTitle,
                  { color: colors.text },
                ]}
              >
                Delete Suite &quot;{deletingSuite.name}&quot;?
              </Text>

              {(() => {
                const caseCount = suiteStatsMap[deletingSuite.id]?.total || 0;
                const otherSuites = suites.filter(
                  (s) => s.id !== deletingSuite.id
                );

                if (caseCount === 0) {
                  return (
                    <Text
                      style={[
                        styles.confirmDialogDesc,
                        { color: colors.textSecondary },
                      ]}
                    >
                      This test suite contains 0 test cases. Are you sure you
                      want to delete it?
                    </Text>
                  );
                }

                return (
                  <View style={{ gap: 10 }}>
                    <Text
                      style={[
                        styles.confirmDialogDesc,
                        { color: colors.textSecondary },
                      ]}
                    >
                      This suite contains{' '}
                      <Text
                        style={{
                          fontWeight: '800',
                          color: colors.text,
                        }}
                      >
                        {caseCount} test {caseCount === 1 ? 'case' : 'cases'}
                      </Text>
                      . Choose how to handle existing test cases:
                    </Text>

                    {otherSuites.length > 0 && (
                      <Pressable
                        onPress={() => setSuiteDeleteMode('move')}
                        accessibilityRole="radio"
                        accessibilityState={{
                          selected: suiteDeleteMode === 'move',
                          checked: suiteDeleteMode === 'move',
                        }}
                        accessibilityLabel={`Move ${caseCount} test cases to another suite`}
                        style={[
                          styles.suiteSelectItem,
                          {
                            backgroundColor:
                              suiteDeleteMode === 'move'
                                ? colors.primarySoft
                                : colors.surfaceMuted,
                            borderColor:
                              suiteDeleteMode === 'move'
                                ? colors.primary
                                : colors.border,
                          },
                        ]}
                      >
                        <VectorIcon
                          name={
                            suiteDeleteMode === 'move' ? 'check' : 'switch'
                          }
                          size={14}
                          color={
                            suiteDeleteMode === 'move'
                              ? colors.primary
                              : colors.textSecondary
                          }
                        />
                        <Text
                          style={[
                            styles.suiteSelectItemText,
                            {
                              color:
                                suiteDeleteMode === 'move'
                                  ? colors.primary
                                  : colors.text,
                            },
                          ]}
                        >
                          Move {caseCount} case(s) to another suite
                        </Text>
                      </Pressable>
                    )}

                    {suiteDeleteMode === 'move' && otherSuites.length > 0 && (
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.optionChipsRow}
                      >
                        {otherSuites.map((s) => {
                          const active = suiteDeleteTargetId === s.id;
                          return (
                            <Pressable
                              key={s.id}
                              onPress={() => setSuiteDeleteTargetId(s.id)}
                              accessibilityRole="radio"
                              accessibilityState={{
                                selected: active,
                                checked: active,
                              }}
                              accessibilityLabel={`Destination suite: ${s.name}`}
                              style={[
                                styles.optionChip,
                                {
                                  backgroundColor: active
                                    ? colors.primary
                                    : colors.surfaceMuted,
                                  borderColor: active
                                    ? colors.primary
                                    : colors.border,
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.optionChipText,
                                  {
                                    color: active
                                      ? '#ffffff'
                                      : colors.textSecondary,
                                  },
                                ]}
                              >
                                {s.name}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </ScrollView>
                    )}

                    <Pressable
                      onPress={() => setSuiteDeleteMode('delete')}
                      accessibilityRole="radio"
                      accessibilityState={{
                        selected: suiteDeleteMode === 'delete',
                        checked: suiteDeleteMode === 'delete',
                      }}
                      accessibilityLabel={`Delete suite and its ${caseCount} test cases`}
                      style={[
                        styles.suiteSelectItem,
                        {
                          backgroundColor:
                            suiteDeleteMode === 'delete'
                              ? colors.dangerSoft
                              : colors.surfaceMuted,
                          borderColor:
                            suiteDeleteMode === 'delete'
                              ? colors.danger
                              : colors.border,
                        },
                      ]}
                    >
                      <VectorIcon
                        name="trash"
                        size={14}
                        color={
                          suiteDeleteMode === 'delete'
                            ? colors.danger
                            : colors.textSecondary
                        }
                      />
                      <Text
                        style={[
                          styles.suiteSelectItemText,
                          {
                            color:
                              suiteDeleteMode === 'delete'
                                ? colors.danger
                                : colors.text,
                          },
                        ]}
                      >
                        Delete suite and its {caseCount} test case(s)
                      </Text>
                    </Pressable>
                  </View>
                );
              })()}

              {deleteSuiteError ? (
                <View
                  style={[
                    styles.formAlertBox,
                    {
                      backgroundColor: colors.dangerSoft,
                      borderColor: colors.danger,
                      marginTop: 8,
                    },
                  ]}
                >
                  <Text style={[styles.formAlertText, { color: colors.danger }]}>
                    {deleteSuiteError}
                  </Text>
                </View>
              ) : null}

              <View style={styles.smallModalActions}>
                <Pressable
                  disabled={isDeletingSuite}
                  onPress={handleClose}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: Boolean(isDeletingSuite) }}
                  accessibilityLabel="Cancel deleting test suite"
                  style={[
                    styles.footerSecondaryBtn,
                    {
                      backgroundColor: colors.surfaceMuted,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.footerSecondaryText,
                      { color: colors.textSecondary },
                    ]}
                  >
                    Cancel
                  </Text>
                </Pressable>
                <Pressable
                  disabled={isDeletingSuite}
                  onPress={handleConfirmDeleteSuite}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: Boolean(isDeletingSuite) }}
                  accessibilityLabel="Delete Suite"
                  style={[
                    styles.footerPrimaryBtn,
                    { backgroundColor: colors.danger },
                  ]}
                >
                  {isDeletingSuite ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Text style={styles.footerPrimaryText}>Delete Suite</Text>
                  )}
                </Pressable>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}
