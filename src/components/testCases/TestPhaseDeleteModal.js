import React from 'react';
import { Text, View, Pressable, Modal, ActivityIndicator } from 'react-native';
import { useTheme } from '../../theme/theme';
import styles from './testCasesStyles';

export default function TestPhaseDeleteModal({
  deletingPhase,
  setDeletingPhase,
  isDeletingPhase,
  handleConfirmDeletePhase,
  deletePhaseError,
  onCancelDeletePhase,
}) {
  const { colors } = useTheme();
  const handleClose = () => {
    if (isDeletingPhase) return;
    if (typeof onCancelDeletePhase === 'function') {
      onCancelDeletePhase();
    } else if (typeof setDeletingPhase === 'function') {
      setDeletingPhase(null);
    }
  };

  return (
    <Modal
      visible={!!deletingPhase}
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
          {deletingPhase && (
            <>
              <Text
                accessibilityRole="header"
                style={[
                  styles.smallModalTitle,
                  { color: colors.text },
                ]}
              >
                Delete Phase &quot;{deletingPhase.name}&quot;?
              </Text>
              <Text
                style={[
                  styles.confirmDialogDesc,
                  { color: colors.textSecondary },
                ]}
              >
                Deleting this testing phase will remove the phase milestone
                from the Test Plan while preserving all existing test suites
                and test cases in the project.
              </Text>

              {deletePhaseError ? (
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
                    {deletePhaseError}
                  </Text>
                </View>
              ) : null}

              <View style={styles.smallModalActions}>
                <Pressable
                  disabled={isDeletingPhase}
                  onPress={handleClose}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: Boolean(isDeletingPhase) }}
                  accessibilityLabel="Cancel deleting phase"
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
                  disabled={isDeletingPhase}
                  onPress={handleConfirmDeletePhase}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: Boolean(isDeletingPhase) }}
                  accessibilityLabel="Delete Phase"
                  style={[
                    styles.footerPrimaryBtn,
                    { backgroundColor: colors.danger },
                  ]}
                >
                  {isDeletingPhase ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Text style={styles.footerPrimaryText}>Delete Phase</Text>
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
