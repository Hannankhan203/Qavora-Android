import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
} from 'react-native';
import VectorIcon from '../VectorIcon';
import styles from './testRunsStyles';

export default function TestRunDeleteModal({
  theme,
  runPendingDelete,
  setRunPendingDelete,
  isDeletingRun,
  handleConfirmDeleteRun,
  runDeleteError,
  onCancelDeleteRun,
}) {
  const handleClose = () => {
    if (isDeletingRun) return;
    if (typeof onCancelDeleteRun === 'function') {
      onCancelDeleteRun();
    } else if (typeof setRunPendingDelete === 'function') {
      setRunPendingDelete(null);
    }
  };

  return (
    <Modal
      visible={!!runPendingDelete}
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
          <Text
            accessibilityRole="header"
            style={[styles.confirmTitle, { color: theme.text }]}
          >
            Delete Test Run?
          </Text>
          <Text
            style={[
              styles.confirmDesc,
              { color: theme.textSecondary },
            ]}
          >
            Are you sure you want to delete{' '}
            <Text style={{ fontWeight: '800', color: theme.text }}>
              {runPendingDelete?.name} ({runPendingDelete?.id})
            </Text>
            ? Its execution history will be removed and any linked defects will be safely unlinked.
          </Text>

          {runDeleteError ? (
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
                {runDeleteError}
              </Text>
            </View>
          ) : null}

          <View style={styles.confirmBtnRow}>
            <TouchableOpacity
              style={[
                styles.confirmCancelBtn,
                {
                  backgroundColor: theme.surfaceMuted,
                  borderColor: theme.border,
                },
              ]}
              accessibilityRole="button"
              accessibilityState={{ disabled: Boolean(isDeletingRun) }}
              accessibilityLabel="Cancel deleting test run"
              onPress={handleClose}
              disabled={isDeletingRun}
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
              style={[
                styles.confirmDeleteBtn,
                {
                  backgroundColor: theme.danger,
                  opacity: isDeletingRun ? 0.7 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityState={{ disabled: Boolean(isDeletingRun) }}
              accessibilityLabel="Delete Run"
              onPress={handleConfirmDeleteRun}
              disabled={isDeletingRun}
            >
              {isDeletingRun ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <VectorIcon name="trash" size={14} color="#FFFFFF" />
              )}
              <Text style={styles.confirmDeleteText}>Delete Run</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
