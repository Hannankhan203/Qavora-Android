import React from 'react';
import { Text, View, Pressable, Modal, ActivityIndicator } from 'react-native';
import { useTheme } from '../../theme/theme';
import styles from './testCasesStyles';

export default function TestPhaseDeleteModal({
  deletingPhase,
  setDeletingPhase,
  isDeletingPhase,
  handleConfirmDeletePhase,
}) {
  const { colors } = useTheme();

  return (
    <Modal
      visible={!!deletingPhase}
      animationType="fade"
      transparent
      onRequestClose={() => !isDeletingPhase && setDeletingPhase(null)}
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

              <View style={styles.smallModalActions}>
                <Pressable
                  disabled={isDeletingPhase}
                  onPress={() => setDeletingPhase(null)}
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
