import React from 'react';
import { View, Text, Pressable, Modal } from 'react-native';
import { useTheme } from '../../theme/theme';
import styles from './checklistsStyles';

export default function ChecklistDeleteModal({
  deleteTargetChecklist,
  setDeleteTargetChecklist,
  handleConfirmDeleteChecklist,
  busyMutation,
}) {
  const { colors } = useTheme();

  return (
    <Modal
      visible={Boolean(deleteTargetChecklist)}
      transparent
      animationType="fade"
      onRequestClose={() => setDeleteTargetChecklist(null)}
    >
      <View
        accessibilityViewIsModal={true}
        style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]}
      >
        <View
          style={[
            styles.modalCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text
            accessibilityRole="header"
            style={[styles.modalTitle, { color: colors.danger }]}
          >
            Delete QA Checklist?
          </Text>
          <Text
            style={[
              styles.detailDesc,
              { color: colors.textSecondary, marginBottom: 16 },
            ]}
          >
            Are you sure you want to permanently delete{' '}
            <Text style={{ fontWeight: '700', color: colors.text }}>
              {deleteTargetChecklist?.title}
            </Text>{' '}
            and its {deleteTargetChecklist?.totalItems || 0} verification
            items? This action cannot be undone.
          </Text>

          <View style={styles.modalActionsRow}>
            <Pressable
              onPress={() => setDeleteTargetChecklist(null)}
              disabled={busyMutation}
              accessibilityRole="button"
              accessibilityState={{ disabled: Boolean(busyMutation) }}
              accessibilityLabel="Cancel deleting checklist"
              style={[
                styles.modalCancelBtn,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.borderStrong,
                },
              ]}
            >
              <Text style={[styles.modalCancelText, { color: colors.text }]}>
                Cancel
              </Text>
            </Pressable>

            <Pressable
              onPress={handleConfirmDeleteChecklist}
              disabled={busyMutation}
              accessibilityRole="button"
              accessibilityState={{ disabled: Boolean(busyMutation) }}
              accessibilityLabel="Delete checklist permanently"
              style={[
                styles.modalConfirmBtn,
                {
                  backgroundColor: colors.danger,
                  opacity: busyMutation ? 0.6 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.modalConfirmText,
                  { color: colors.textOnPrimary },
                ]}
              >
                {busyMutation ? 'Deleting...' : 'Delete Permanently'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
