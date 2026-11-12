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
}) {
  return (
    <Modal
      visible={!!runPendingDelete}
      animationType="fade"
      transparent
      onRequestClose={() => setRunPendingDelete(null)}
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
              onPress={() => setRunPendingDelete(null)}
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
