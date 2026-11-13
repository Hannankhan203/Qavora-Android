import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
} from 'react-native';
import VectorIcon from '../VectorIcon';
import styles from './defectsStyles';

export default function DefectDeleteModal({
  theme,
  defectPendingDelete,
  isDeletingDefect,
  handleConfirmDeleteDefect,
  defectDeleteError,
  onCancelDeleteDefect,
}) {
  const handleClose = () => {
    if (isDeletingDefect) return;
    if (typeof onCancelDeleteDefect === 'function') {
      onCancelDeleteDefect();
    }
  };

  return (
    <Modal
      visible={!!defectPendingDelete}
      animationType="fade"
      transparent
      onRequestClose={handleClose}
    >
      <View
        accessibilityViewIsModal={true}
        style={[
          styles.confirmOverlay,
          { backgroundColor: theme.overlay },
        ]}
      >
        <View
          style={[
            styles.confirmCard,
            {
              backgroundColor: theme.surface,
              borderColor: theme.border,
            },
          ]}
        >
          <View
            style={[
              styles.confirmIconCircle,
              { backgroundColor: theme.dangerSoft },
            ]}
          >
            <VectorIcon name="trash" size={22} color={theme.danger} />
          </View>
          <Text style={[styles.confirmTitle, { color: theme.text }]}>
            Delete Defect?
          </Text>
          <Text
            style={[
              styles.confirmDesc,
              { color: theme.textSecondary },
            ]}
          >
            Are you sure you want to delete{' '}
            <Text style={{ fontWeight: '800', color: theme.text }}>
              {defectPendingDelete?.defectId || defectPendingDelete?.id}:{' '}
              {defectPendingDelete?.title}
            </Text>
            ? Any linked test execution records will be safely unlinked.
          </Text>

          {defectDeleteError ? (
            <View
              style={[
                styles.formErrorBox,
                {
                  backgroundColor: theme.dangerSoft,
                  borderColor: theme.danger,
                  width: '100%',
                  marginBottom: 10,
                },
              ]}
            >
              <Text style={[styles.formErrorText, { color: theme.danger }]}>
                {defectDeleteError}
              </Text>
            </View>
          ) : null}

          <View style={styles.confirmBtnRow}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityState={{ disabled: Boolean(isDeletingDefect) }}
              accessibilityLabel="Cancel deleting defect"
              style={[
                styles.confirmCancelBtn,
                {
                  backgroundColor: theme.surfaceMuted,
                  borderColor: theme.border,
                },
              ]}
              onPress={handleClose}
              disabled={isDeletingDefect}
            >
              <Text
                style={[
                  styles.confirmCancelText,
                  { color: theme.textSecondary },
                ]}
              >
                Cancel
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              accessibilityRole="button"
              accessibilityState={{ disabled: Boolean(isDeletingDefect) }}
              accessibilityLabel={`Confirm delete defect ${
                defectPendingDelete?.defectId ||
                defectPendingDelete?.id ||
                ''
              }`}
              style={[
                styles.confirmDeleteBtn,
                {
                  backgroundColor: theme.danger,
                  opacity: isDeletingDefect ? 0.7 : 1,
                },
              ]}
              onPress={handleConfirmDeleteDefect}
              disabled={isDeletingDefect}
            >
              {isDeletingDefect ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <VectorIcon name="trash" size={14} color="#FFFFFF" />
              )}
              <Text style={styles.confirmDeleteText}>Delete Defect</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
