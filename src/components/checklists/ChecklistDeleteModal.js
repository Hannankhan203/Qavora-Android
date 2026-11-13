import React from 'react';
import { View, Text, Pressable, Modal } from 'react-native';
import { useTheme } from '../../theme/theme';
import styles from './checklistsStyles';

export default function ChecklistDeleteModal({
  deleteTargetChecklist,
  setDeleteTargetChecklist,
  handleConfirmDeleteChecklist,
  busyMutation,
  deleteChecklistError,
  onCancelDeleteChecklist,
}) {
  const { colors } = useTheme();
  const handleClose = () => {
    if (busyMutation) return;
    if (typeof onCancelDeleteChecklist === 'function') {
      onCancelDeleteChecklist();
    } else if (typeof setDeleteTargetChecklist === 'function') {
      setDeleteTargetChecklist(null);
    }
  };

  return (
    <Modal
      visible={Boolean(deleteTargetChecklist)}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
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

          {deleteChecklistError ? (
            <View
              style={[
                styles.errorAlert,
                {
                  backgroundColor: colors.dangerSoft,
                  borderColor: colors.danger,
                  marginBottom: 12,
                },
              ]}
            >
              <Text style={[styles.errorAlertText, { color: colors.danger }]}>
                {deleteChecklistError}
              </Text>
            </View>
          ) : null}

          <View style={styles.modalActionsRow}>
            <Pressable
              onPress={handleClose}
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
