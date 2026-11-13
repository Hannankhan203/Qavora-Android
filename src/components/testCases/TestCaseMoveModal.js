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

export default function TestCaseMoveModal({
  movingCase,
  setMovingCase,
  isMovingCase,
  suites,
  moveTargetSuiteId,
  setMoveTargetSuiteId,
  handleConfirmMoveCase,
  moveCaseError,
  onCancelMoveCase,
}) {
  const { colors } = useTheme();
  const handleClose = () => {
    if (isMovingCase) return;
    if (typeof onCancelMoveCase === 'function') {
      onCancelMoveCase();
    } else if (typeof setMovingCase === 'function') {
      setMovingCase(null);
    }
  };

  return (
    <Modal
      visible={!!movingCase}
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
          {movingCase && (
            <>
              <Text
                accessibilityRole="header"
                style={[
                  styles.smallModalTitle,
                  { color: colors.text },
                ]}
              >
                Move {movingCase.testCaseId || movingCase.id} to Suite
              </Text>
              <Text
                style={[
                  styles.confirmDialogDesc,
                  { color: colors.textSecondary },
                ]}
              >
                Current Suite: &quot;{movingCase.suiteName}&quot;. Select a
                destination suite below:
              </Text>

              <ScrollView
                style={{ flexShrink: 1, maxHeight: 240 }}
                contentContainerStyle={styles.suiteSelectList}
                showsVerticalScrollIndicator={false}
              >
                {suites.map((s) => {
                  const active = moveTargetSuiteId === s.id;
                  return (
                    <Pressable
                      key={s.id}
                      onPress={() => setMoveTargetSuiteId(s.id)}
                      disabled={Boolean(isMovingCase)}
                      accessibilityRole="radio"
                      accessibilityState={{
                        selected: active,
                        checked: active,
                        disabled: Boolean(isMovingCase),
                      }}
                      accessibilityLabel={`Destination suite: ${s.name}`}
                      style={[
                        styles.suiteSelectItem,
                        {
                          backgroundColor: active
                            ? colors.primarySoft
                            : colors.surfaceMuted,
                          borderColor: active ? colors.primary : colors.border,
                        },
                      ]}
                    >
                      <VectorIcon
                        name={active ? 'check' : 'folder'}
                        size={14}
                        color={active ? colors.primary : colors.textSecondary}
                      />
                      <Text
                        style={[
                          styles.suiteSelectItemText,
                          {
                            color: active
                              ? colors.primary
                              : colors.text,
                          },
                        ]}
                      >
                        {s.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              {moveCaseError ? (
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
                    {moveCaseError}
                  </Text>
                </View>
              ) : null}

              <View style={styles.smallModalActions}>
                <Pressable
                  disabled={isMovingCase}
                  onPress={handleClose}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: Boolean(isMovingCase) }}
                  accessibilityLabel="Cancel moving test case"
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
                  disabled={isMovingCase}
                  onPress={handleConfirmMoveCase}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: Boolean(isMovingCase) }}
                  accessibilityLabel="Move Case"
                  style={[
                    styles.footerPrimaryBtn,
                    { backgroundColor: colors.primary },
                  ]}
                >
                  {isMovingCase ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Text style={styles.footerPrimaryText}>Move Case</Text>
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
