import React from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useTheme } from '../../theme/theme';
import {
  CHECKLIST_CATEGORIES,
  CHECKLIST_PRIORITIES,
} from '../../services/checklistService';
import styles from './checklistsStyles';

export default function ChecklistEditItemModal({
  editingItem,
  setEditingItem,
  editItemTitleRef,
  editItemTitle,
  setEditItemTitle,
  editItemNotesRef,
  editItemCategory,
  setEditItemCategory,
  editItemPriority,
  setEditItemPriority,
  editItemNotes,
  setEditItemNotes,
  editItemError,
  setEditItemError,
  handleSaveEditedItem,
  busyMutation,
}) {
  const { colors } = useTheme();
  const handleClose = () => {
    if (busyMutation) return;
    if (typeof setEditItemError === 'function') {
      setEditItemError(null);
    }
    setEditingItem(null);
  };

  return (
    <Modal
      visible={Boolean(editingItem)}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        accessibilityViewIsModal={true}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
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
            style={[styles.modalTitle, { color: colors.text }]}
          >
            Edit Verification Step
          </Text>
          <ScrollView
            style={styles.modalScrollArea}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {editItemError ? (
              <View
                style={[
                  styles.errorAlert,
                  {
                    backgroundColor: colors.dangerSoft,
                    borderColor: colors.danger,
                  },
                ]}
              >
                <Text style={[styles.errorAlertText, { color: colors.danger }]}>
                  {editItemError}
                </Text>
              </View>
            ) : null}

            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
              Step Title *
            </Text>
            <TextInput
              ref={editItemTitleRef}
              value={editItemTitle}
              onChangeText={(val) => {
                setEditItemTitle(val);
                if (editItemError && typeof setEditItemError === 'function') {
                  setEditItemError(null);
                }
              }}
              editable={!busyMutation}
              accessibilityLabel="Step Title, required"
              returnKeyType="next"
              blurOnSubmit={false}
              onSubmitEditing={() => editItemNotesRef.current?.focus()}
              style={[
                styles.input,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                  color: colors.text,
                },
              ]}
            />

            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
              Category
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[
                styles.horizontalPillsRow,
                { marginBottom: 12 },
              ]}
              accessibilityRole="radiogroup"
            >
              {CHECKLIST_CATEGORIES.map((cat) => {
                const active = editItemCategory === cat;
                return (
                  <Pressable
                    key={cat}
                    onPress={() =>
                      typeof setEditItemCategory === 'function' &&
                      setEditItemCategory(cat)
                    }
                    disabled={busyMutation}
                    hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                    accessibilityRole="radio"
                    accessibilityState={{
                      selected: active,
                      checked: active,
                      disabled: Boolean(busyMutation),
                    }}
                    accessibilityLabel={`Step category: ${cat}`}
                    style={[
                      styles.miniPill,
                      {
                        backgroundColor: active
                          ? colors.primary
                          : colors.background,
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.miniPillText,
                        {
                          color: active
                            ? colors.textOnPrimary
                            : colors.textSecondary,
                        },
                      ]}
                    >
                      {cat}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
              Priority
            </Text>
            <View
              accessibilityRole="radiogroup"
              style={[styles.priorityPillsRow, { marginBottom: 12 }]}
            >
              {CHECKLIST_PRIORITIES.map((prio) => {
                const active = editItemPriority === prio;
                return (
                  <Pressable
                    key={prio}
                    onPress={() => setEditItemPriority(prio)}
                    disabled={busyMutation}
                    hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                    accessibilityRole="radio"
                    accessibilityState={{
                      selected: active,
                      checked: active,
                      disabled: Boolean(busyMutation),
                    }}
                    accessibilityLabel={`Step priority: ${prio}`}
                    style={[
                      styles.miniPill,
                      {
                        backgroundColor: active
                          ? colors.primary
                          : colors.background,
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.miniPillText,
                        {
                          color: active
                            ? colors.textOnPrimary
                            : colors.textSecondary,
                        },
                      ]}
                    >
                      {prio}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
              Notes / Expected Outcome
            </Text>
            <TextInput
              ref={editItemNotesRef}
              value={editItemNotes}
              onChangeText={setEditItemNotes}
              editable={!busyMutation}
              multiline
              accessibilityLabel="Notes or Expected Outcome"
              style={[
                styles.input,
                {
                  minHeight: 68,
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                  color: colors.text,
                  textAlignVertical: 'top',
                  paddingTop: 10,
                },
              ]}
            />
          </ScrollView>

          <View
            style={[
              styles.modalActionsRow,
              { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 },
            ]}
          >
            <Pressable
              onPress={handleClose}
              disabled={busyMutation}
              accessibilityRole="button"
              accessibilityState={{ disabled: Boolean(busyMutation) }}
              accessibilityLabel="Cancel editing step"
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
              onPress={handleSaveEditedItem}
              disabled={busyMutation || !editItemTitle.trim()}
              accessibilityRole="button"
              accessibilityState={{
                disabled: Boolean(busyMutation || !editItemTitle.trim()),
              }}
              accessibilityLabel="Save Step"
              style={[
                styles.modalConfirmBtn,
                {
                  backgroundColor: colors.primary,
                  opacity: busyMutation || !editItemTitle.trim() ? 0.55 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.modalConfirmText,
                  { color: colors.textOnPrimary },
                ]}
              >
                {busyMutation ? 'Saving...' : 'Save Step'}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
