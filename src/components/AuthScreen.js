/**
 * Qavora Android — Authentication Screen (Phase 1B)
 *
 * Provides Login and Registration workflows aligned with Qavora Web's
 * authentication experience (`authUI.js`) and Qavora Android's theme tokens.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useTheme, monoFontFamily } from '../theme/theme';
import { useAuth } from '../context/AuthContext';
import { checkBackendHealth, getApiBaseUrl } from '../services/apiClient';
import { EMAIL_REGEX } from '../services/authService';

const ROLE_OPTIONS = [
  'QA Tester',
  'Lead QA Engineer',
  'QA Automation Engineer',
  'QA Manager',
];

export default function AuthScreen() {
  const { colors, isDark, toggleTheme } = useTheme();
  const {
    login,
    register,
    isLoading,
    authError,
    authNotice,
    clearAuthFeedback,
  } = useAuth();

  const [mode, setMode] = useState('login'); // 'login' | 'register'

  // Login fields
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  // Register fields
  const [registerName, setRegisterName] = useState('');
  const [registerEmail, setRegisterEmail] = useState('');
  const [registerRole, setRegisterRole] = useState('QA Tester');
  const [registerPassword, setRegisterPassword] = useState('');
  const [registerConfirmPassword, setRegisterConfirmPassword] = useState('');
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);

  // Local validation message
  const [localError, setLocalError] = useState(null);

  // Backend health status
  const [healthState, setHealthState] = useState({
    checking: true,
    ok: false,
    database: null,
    message: 'Checking backend connection...',
  });

  const runHealthCheck = useCallback(async () => {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) {
      setHealthState({
        checking: false,
        ok: false,
        database: null,
        message: 'EXPO_PUBLIC_API_BASE_URL is not configured.',
      });
      return;
    }

    setHealthState((prev) => ({
      ...prev,
      checking: true,
      message: 'Checking backend connection...',
    }));

    const result = await checkBackendHealth();
    if (result.ok) {
      const dbStatus =
        (result.data && result.data.database) || 'connected';
      setHealthState({
        checking: false,
        ok: true,
        database: dbStatus,
        message: `Connected (${dbStatus}) · ${result.latencyMs}ms`,
      });
    } else {
      setHealthState({
        checking: false,
        ok: false,
        database: 'disconnected',
        message:
          (result.error && result.error.message) ||
          'Backend server unreachable.',
      });
    }
  }, []);

  useEffect(() => {
    runHealthCheck();
  }, [runHealthCheck]);

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setLocalError(null);
    clearAuthFeedback();
  };

  const handleLoginSubmit = async () => {
    setLocalError(null);
    clearAuthFeedback();

    const trimmedEmail = loginEmail.trim().toLowerCase();
    if (!trimmedEmail || !EMAIL_REGEX.test(trimmedEmail)) {
      setLocalError('Please enter a valid email address.');
      return;
    }
    if (!loginPassword) {
      setLocalError('Please enter your password.');
      return;
    }

    await login({
      email: trimmedEmail,
      password: loginPassword,
    });
  };

  const handleRegisterSubmit = async () => {
    setLocalError(null);
    clearAuthFeedback();

    const trimmedName = registerName.trim();
    const trimmedEmail = registerEmail.trim().toLowerCase();

    if (!trimmedName) {
      setLocalError('Full name is required.');
      return;
    }
    if (!trimmedEmail || !EMAIL_REGEX.test(trimmedEmail)) {
      setLocalError('Please enter a valid email address.');
      return;
    }
    if (registerPassword.length < 8) {
      setLocalError('Password must be at least 8 characters long.');
      return;
    }
    if (registerPassword !== registerConfirmPassword) {
      setLocalError('Passwords do not match.');
      return;
    }

    await register({
      name: trimmedName,
      email: trimmedEmail,
      password: registerPassword,
      role: registerRole.trim() || 'QA Tester',
    });
  };

  const activeError = localError || authError;

  return (
    <SafeAreaView
      edges={['top', 'bottom', 'left', 'right']}
      style={[styles.safeRoot, { backgroundColor: colors.background }]}
    >
      <StatusBar style={colors.statusBar} />

      {/* Top Bar */}
      <View
        style={[
          styles.topBar,
          { backgroundColor: colors.surface, borderBottomColor: colors.border },
        ]}
      >
        <View style={styles.topBarInner}>
          <View style={styles.brandLockup}>
            <View style={[styles.brandBadge, { backgroundColor: colors.primary }]}>
              <Text style={[styles.brandBadgeText, { color: colors.textOnPrimary }]}>
                Q
              </Text>
            </View>
            <View>
              <Text style={[styles.brandTitle, { color: colors.text }]}>
                Qavora
              </Text>
              <Text
                style={[
                  styles.brandSubtitle,
                  { color: colors.textMuted, fontFamily: monoFontFamily },
                ]}
              >
                QA Testing Manager · Authentication
              </Text>
            </View>
          </View>

          <Pressable
            onPress={toggleTheme}
            style={[
              styles.themeBtn,
              {
                backgroundColor: colors.surfaceAccent,
                borderColor: colors.primary,
              },
            ]}
          >
            <Text style={[styles.themeBtnText, { color: colors.primary }]}>
              {isDark ? 'Light' : 'Dark'}
            </Text>
          </Pressable>
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.flexOne}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Main Auth Card */}
          <View
            style={[
              styles.authCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text
              style={[
                styles.kicker,
                { color: colors.primary, fontFamily: monoFontFamily },
              ]}
            >
              QAVORA CLOUD WORKSPACE
            </Text>
            <Text style={[styles.heading, { color: colors.text }]}>
              {mode === 'login'
                ? 'Sign in to your QA account'
                : 'Create your QA account'}
            </Text>
            <Text style={[styles.subheading, { color: colors.textSecondary }]}>
              {mode === 'login'
                ? 'Authenticate with your Qavora credentials to access your QA workspace.'
                : 'Register a new tester profile on the Qavora backend.'}
            </Text>

            {/* Backend Connection Status Bar */}
            <View
              style={[
                styles.healthBar,
                {
                  backgroundColor: colors.background,
                  borderColor: healthState.ok
                    ? colors.success
                    : colors.borderStrong,
                },
              ]}
            >
              <View style={styles.healthLeft}>
                <View
                  style={[
                    styles.healthDot,
                    {
                      backgroundColor: healthState.checking
                        ? colors.warning
                        : healthState.ok
                        ? colors.success
                        : colors.danger,
                    },
                  ]}
                />
                <Text
                  numberOfLines={2}
                  style={[
                    styles.healthText,
                    { color: colors.textSecondary, fontFamily: monoFontFamily },
                  ]}
                >
                  {healthState.message}
                </Text>
              </View>
              <Pressable
                onPress={runHealthCheck}
                disabled={healthState.checking}
                style={[
                  styles.healthRetryBtn,
                  { borderColor: colors.borderStrong },
                ]}
              >
                <Text
                  style={[
                    styles.healthRetryText,
                    { color: colors.primary, fontFamily: monoFontFamily },
                  ]}
                >
                  {healthState.checking ? '...' : 'Check'}
                </Text>
              </Pressable>
            </View>

            {/* Mode Switcher Tabs */}
            <View
              style={[
                styles.modeTabsRow,
                {
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                },
              ]}
            >
              <Pressable
                onPress={() => switchMode('login')}
                style={[
                  styles.modeTabBtn,
                  mode === 'login' && {
                    backgroundColor: colors.primary,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.modeTabText,
                    {
                      color:
                        mode === 'login'
                          ? colors.textOnPrimary
                          : colors.textSecondary,
                    },
                  ]}
                >
                  Sign In
                </Text>
              </Pressable>

              <Pressable
                onPress={() => switchMode('register')}
                style={[
                  styles.modeTabBtn,
                  mode === 'register' && {
                    backgroundColor: colors.primary,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.modeTabText,
                    {
                      color:
                        mode === 'register'
                          ? colors.textOnPrimary
                          : colors.textSecondary,
                    },
                  ]}
                >
                  Create Account
                </Text>
              </Pressable>
            </View>

            {/* Notice Banner (e.g., Session Expired or Signed Out) */}
            {authNotice && !activeError ? (
              <View
                style={[
                  styles.alertBox,
                  {
                    backgroundColor: colors.infoSoft,
                    borderColor: colors.info,
                  },
                ]}
              >
                <Text style={[styles.alertText, { color: colors.text }]}>
                  {authNotice}
                </Text>
              </View>
            ) : null}

            {/* Error Banner */}
            {activeError ? (
              <View
                style={[
                  styles.alertBox,
                  {
                    backgroundColor: colors.dangerSoft,
                    borderColor: colors.danger,
                  },
                ]}
              >
                <Text style={[styles.alertText, { color: colors.danger }]}>
                  {activeError}
                </Text>
              </View>
            ) : null}

            {mode === 'login' ? (
              /* LOGIN FORM */
              <View style={styles.formSection}>
                <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                  Email Address
                </Text>
                <TextInput
                  value={loginEmail}
                  onChangeText={setLoginEmail}
                  placeholder="tester@example.com"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isLoading}
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      color: colors.text,
                    },
                  ]}
                />

                <View style={styles.passwordHeaderRow}>
                  <Text
                    style={[styles.fieldLabel, { color: colors.textSecondary }]}
                  >
                    Password
                  </Text>
                  <Pressable
                    onPress={() => setShowLoginPassword((prev) => !prev)}
                  >
                    <Text
                      style={[
                        styles.togglePassText,
                        { color: colors.primary, fontFamily: monoFontFamily },
                      ]}
                    >
                      {showLoginPassword ? 'Hide' : 'Show'}
                    </Text>
                  </Pressable>
                </View>
                <TextInput
                  value={loginPassword}
                  onChangeText={setLoginPassword}
                  placeholder="Enter your password"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry={!showLoginPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isLoading}
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      color: colors.text,
                    },
                  ]}
                />

                <Pressable
                  onPress={handleLoginSubmit}
                  disabled={isLoading}
                  style={[
                    styles.submitBtn,
                    {
                      backgroundColor: colors.primary,
                      opacity: isLoading ? 0.7 : 1,
                    },
                  ]}
                >
                  {isLoading ? (
                    <View style={styles.loadingBtnRow}>
                      <ActivityIndicator
                        size="small"
                        color={colors.textOnPrimary}
                      />
                      <Text
                        style={[
                          styles.submitBtnText,
                          { color: colors.textOnPrimary },
                        ]}
                      >
                        Signing in...
                      </Text>
                    </View>
                  ) : (
                    <Text
                      style={[
                        styles.submitBtnText,
                        { color: colors.textOnPrimary },
                      ]}
                    >
                      Sign In to Qavora
                    </Text>
                  )}
                </Pressable>

                <Pressable
                  onPress={() => switchMode('register')}
                  style={styles.switchLinkWrap}
                >
                  <Text
                    style={[
                      styles.switchLinkText,
                      { color: colors.textSecondary },
                    ]}
                  >
                    Don&apos;t have an account?{' '}
                    <Text
                      style={{ color: colors.primary, fontWeight: '700' }}
                    >
                      Create Account
                    </Text>
                  </Text>
                </Pressable>
              </View>
            ) : (
              /* REGISTER FORM */
              <View style={styles.formSection}>
                <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
                  Full Name
                </Text>
                <TextInput
                  value={registerName}
                  onChangeText={setRegisterName}
                  placeholder="Alex Rivera"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="words"
                  editable={!isLoading}
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
                  Email Address
                </Text>
                <TextInput
                  value={registerEmail}
                  onChangeText={setRegisterEmail}
                  placeholder="alex.rivera@example.com"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isLoading}
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
                  QA Role
                </Text>
                <View style={styles.roleChipsRow}>
                  {ROLE_OPTIONS.map((roleOpt) => {
                    const selected = registerRole === roleOpt;
                    return (
                      <Pressable
                        key={roleOpt}
                        onPress={() => setRegisterRole(roleOpt)}
                        style={[
                          styles.roleChip,
                          {
                            backgroundColor: selected
                              ? colors.primary
                              : colors.background,
                            borderColor: selected
                              ? colors.primary
                              : colors.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.roleChipText,
                            {
                              color: selected
                                ? colors.textOnPrimary
                                : colors.textSecondary,
                            },
                          ]}
                        >
                          {roleOpt}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <View style={styles.passwordHeaderRow}>
                  <Text
                    style={[styles.fieldLabel, { color: colors.textSecondary }]}
                  >
                    Password (minimum 8 characters)
                  </Text>
                  <Pressable
                    onPress={() => setShowRegisterPassword((prev) => !prev)}
                  >
                    <Text
                      style={[
                        styles.togglePassText,
                        { color: colors.primary, fontFamily: monoFontFamily },
                      ]}
                    >
                      {showRegisterPassword ? 'Hide' : 'Show'}
                    </Text>
                  </Pressable>
                </View>
                <TextInput
                  value={registerPassword}
                  onChangeText={setRegisterPassword}
                  placeholder="At least 8 characters"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry={!showRegisterPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isLoading}
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
                  Confirm Password
                </Text>
                <TextInput
                  value={registerConfirmPassword}
                  onChangeText={setRegisterConfirmPassword}
                  placeholder="Re-enter your password"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry={!showRegisterPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!isLoading}
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.border,
                      color: colors.text,
                    },
                  ]}
                />

                <Pressable
                  onPress={handleRegisterSubmit}
                  disabled={isLoading}
                  style={[
                    styles.submitBtn,
                    {
                      backgroundColor: colors.primary,
                      opacity: isLoading ? 0.7 : 1,
                    },
                  ]}
                >
                  {isLoading ? (
                    <View style={styles.loadingBtnRow}>
                      <ActivityIndicator
                        size="small"
                        color={colors.textOnPrimary}
                      />
                      <Text
                        style={[
                          styles.submitBtnText,
                          { color: colors.textOnPrimary },
                        ]}
                      >
                        Creating account...
                      </Text>
                    </View>
                  ) : (
                    <Text
                      style={[
                        styles.submitBtnText,
                        { color: colors.textOnPrimary },
                      ]}
                    >
                      Create Qavora Account
                    </Text>
                  )}
                </Pressable>

                <Pressable
                  onPress={() => switchMode('login')}
                  style={styles.switchLinkWrap}
                >
                  <Text
                    style={[
                      styles.switchLinkText,
                      { color: colors.textSecondary },
                    ]}
                  >
                    Already have an account?{' '}
                    <Text
                      style={{ color: colors.primary, fontWeight: '700' }}
                    >
                      Sign In
                    </Text>
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeRoot: {
    flex: 1,
  },
  flexOne: {
    flex: 1,
  },
  topBar: {
    height: 54,
    borderBottomWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  topBarInner: {
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandLockup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandBadge: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandBadgeText: {
    fontSize: 16,
    fontWeight: '700',
  },
  brandTitle: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  brandSubtitle: {
    fontSize: 11,
  },
  themeBtn: {
    minHeight: 36,
    minWidth: 54,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  themeBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  scrollContent: {
    paddingHorizontal: 14,
    paddingVertical: 24,
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
  },
  authCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
  },
  kicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  heading: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 4,
  },
  subheading: {
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 14,
  },
  healthBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 14,
    gap: 8,
  },
  healthLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  healthDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  healthText: {
    fontSize: 11,
    flex: 1,
  },
  healthRetryBtn: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  healthRetryText: {
    fontSize: 11,
    fontWeight: '700',
  },
  modeTabsRow: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 1,
    padding: 3,
    marginBottom: 14,
  },
  modeTabBtn: {
    flex: 1,
    minHeight: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeTabText: {
    fontSize: 13,
    fontWeight: '700',
  },
  alertBox: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
  },
  alertText: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  formSection: {
    marginTop: 2,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  passwordHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  togglePassText: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    marginBottom: 12,
  },
  roleChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  roleChip: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  roleChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  submitBtn: {
    minHeight: 46,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  loadingBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  submitBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  switchLinkWrap: {
    marginTop: 14,
    alignItems: 'center',
    paddingVertical: 6,
  },
  switchLinkText: {
    fontSize: 13,
  },
});
