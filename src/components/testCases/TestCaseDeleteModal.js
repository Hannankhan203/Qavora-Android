import React from 'react';
import { Text, View, Pressable, Modal, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/theme';
import styles from './testCasesStyles';

export default function TestCaseDeleteModal({
  deletingCase,
  setDeletingCase,
  isDeletingCase,
  handleConfirmDeleteCase,
  deleteCaseError,
  onCancelDeleteCase,
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const handleClose = () => {
    if (isDeletingCase) return;
    if (typeof onCancelDeleteCase === 'function') {
      onCancelDeleteCase();
    } else if (typeof setDeletingCase === 'function') {
      setDeletingCase(null);
    }
  };

  return (
    <Modal
      visible={!!deletingCase}
      animationType="fade"
      transparent
      onRequestClose={handleClose}
    >
      <View
        accessibilityViewIsModal={true}
        style={[
          styles.centeredModalOverlay,
          {
            backgroundColor: colors.overlay,
            paddingTop: Math.max(20, insets.top),
            paddingBottom: Math.max(20, insets.bottom + 8),
          },
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
          {deletingCase && (
            <>
              <Text
                accessibilityRole="header"
                style={[
                  styles.smallModalTitle,
                  { color: colors.text },
                ]}
              >
                Delete Test Case?
              </Text>
              <Text
                style={[
                  styles.confirmDialogDesc,
                  { color: colors.textSecondary },
                ]}
              >
                Are you sure you want to permanently delete{' '}
                <Text style={{ fontWeight: '800', color: colors.text }}>
                  {deletingCase.testCaseId || deletingCase.id}: &quot;
                  {deletingCase.title}&quot;
                </Text>{' '}
                from suite &quot;{deletingCase.suiteName}&quot;?
              </Text>

              {deleteCaseError ? (
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
                    {deleteCaseError}
                  </Text>
                </View>
              ) : null}

              <View style={styles.smallModalActions}>
                <Pressable
                  disabled={isDeletingCase}
                  onPress={handleClose}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: Boolean(isDeletingCase) }}
                  accessibilityLabel="Cancel deleting test case"
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
                  disabled={isDeletingCase}
                  onPress={handleConfirmDeleteCase}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: Boolean(isDeletingCase) }}
                  accessibilityLabel="Confirm Delete test case"
                  style={[
                    styles.footerPrimaryBtn,
                    { backgroundColor: colors.danger },
                  ]}
                >
                  {isDeletingCase ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Text style={styles.footerPrimaryText}>
                      Confirm Delete
                    </Text>
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
