/**
 * Qavora Android — Authentication Screen (Phase 1B & MEDIUM-3 Keyboard UX + Safe Diagnostics)
 *
 * Provides Login and Registration workflows aligned with Qavora Web's
 * authentication experience (`authUI.js`) and Qavora Android's theme tokens.
 *
 * Keyboard & Error UX Guarantees (MEDIUM-3):
 * - Keyboard-aware layout and automatic scroll-to-focused-input on narrow Android screens (360dp).
 * - Full Next/Done return-key navigation across Login and Registration fields.
 * - Inline + label-row password visibility toggles accessible while the keyboard is open.
 * - Password-manager and autofill compatibility (`autoComplete`, `textContentType`, `importantForAutofill`).
 * - Field-level validation feedback + sanitized user-facing error messages via `formatAuthErrorMessage`.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useTheme, monoFontFamily } from '../theme/theme';
import { useAuth } from '../context/AuthContext';
import { checkBackendHealth, getApiBaseUrl } from '../services/apiClient';
import {
  EMAIL_REGEX,
  formatAuthErrorMessage,
} from '../services/authService';

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
  const [showRegisterConfirmPassword, setShowRegisterConfirmPassword] =
    useState(false);

  // Field-level & form-level validation state
  const [localError, setLocalError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [focusedField, setFocusedField] = useState(null);

  // Keyboard tracking state for narrow Android screens
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // Refs for scroll management and Next/Done input focus chaining
  const scrollViewRef = useRef(null);
  const authCardYRef = useRef(0);
  const formSectionYRef = useRef(0);
  const fieldOffsetsRef = useRef({});
  const focusedFieldRef = useRef(null);

  const loginEmailInputRef = useRef(null);
  const loginPasswordInputRef = useRef(null);
  const registerNameInputRef = useRef(null);
  const registerEmailInputRef = useRef(null);
  const registerPasswordInputRef = useRef(null);
  const registerConfirmPasswordInputRef = useRef(null);

  // Backend health status
  const [healthState, setHealthState] = useState({
    checking: true,
    ok: false,
    database: null,
    message: 'Checking server connection...',
  });

  /**
   * Scrolls the ScrollView so the specified field and adjacent controls remain
   * clearly visible above the software keyboard on narrow Android screens.
   */
  const scrollToField = useCallback((fieldKey, delayMs = 60) => {
    if (!fieldKey) return;
    setTimeout(() => {
      if (!scrollViewRef.current) return;
      const fieldY = fieldOffsetsRef.current[fieldKey];
      if (typeof fieldY === 'number') {
        const targetY = Math.max(
          0,
          authCardYRef.current + formSectionYRef.current + fieldY - 28
        );
        scrollViewRef.current.scrollTo({ y: targetY, animated: true });
      }
    }, delayMs);
  }, []);

  // Track Android / iOS software keyboard open & close events
  useEffect(() => {
    const showEvent =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, (event) => {
      const height =
        (event &&
          event.endCoordinates &&
          typeof event.endCoordinates.height === 'number' &&
          event.endCoordinates.height) ||
        280;
      setIsKeyboardVisible(true);
      setKeyboardHeight(height);
      if (focusedFieldRef.current) {
        scrollToField(focusedFieldRef.current, 80);
      }
    });

    const hideSub = Keyboard.addListener(hideEvent, () => {
      setIsKeyboardVisible(false);
      setKeyboardHeight(0);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [scrollToField]);

  const handleFieldFocus = useCallback(
    (fieldKey) => {
      focusedFieldRef.current = fieldKey;
      setFocusedField(fieldKey);
      scrollToField(fieldKey, 90);
    },
    [scrollToField]
  );

  const handleFieldBlur = useCallback((fieldKey) => {
    if (focusedFieldRef.current === fieldKey) {
      focusedFieldRef.current = null;
    }
    setFocusedField((prev) => (prev === fieldKey ? null : prev));
  }, []);

  const recordFieldLayout = useCallback((fieldKey, event) => {
    const y = event?.nativeEvent?.layout?.y;
    if (typeof y === 'number') {
      fieldOffsetsRef.current[fieldKey] = y;
    }
  }, []);

  const clearFieldError = useCallback((fieldKey) => {
    setFieldErrors((prev) => {
      if (!prev[fieldKey]) return prev;
      const next = { ...prev };
      delete next[fieldKey];
      return next;
    });
    setLocalError(null);
  }, []);

  const runHealthCheck = useCallback(async () => {
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) {
      setHealthState({
        checking: false,
        ok: false,
        database: null,
        message: 'Server connection URL is not configured.',
      });
      return;
    }

    setHealthState((prev) => ({
      ...prev,
      checking: true,
      message: 'Checking server connection...',
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
        message: formatAuthErrorMessage(result.error, 'health'),
      });
    }
  }, []);

  useEffect(() => {
    runHealthCheck();
  }, [runHealthCheck]);

  const switchMode = useCallback(
    (nextMode) => {
      Keyboard.dismiss();
      setMode(nextMode);
      setLocalError(null);
      setFieldErrors({});
      clearAuthFeedback();
    },
    [clearAuthFeedback]
  );

  const handleLoginSubmit = async () => {
    if (isLoading) return;
    Keyboard.dismiss();
    setLocalError(null);
    setFieldErrors({});
    clearAuthFeedback();

    const trimmedEmail = loginEmail.trim().toLowerCase();
    const nextFieldErrors = {};

    if (!trimmedEmail || !EMAIL_REGEX.test(trimmedEmail)) {
      nextFieldErrors.email = 'Please enter a valid email address.';
    }
    if (!loginPassword) {
      nextFieldErrors.password = 'Please enter your password.';
    }

    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      setLocalError(nextFieldErrors.email || nextFieldErrors.password);
      return;
    }

    const result = await login({
      email: trimmedEmail,
      password: loginPassword,
    });

    if (result && !result.ok && result.field) {
      setFieldErrors({ [result.field]: result.error });
    }
  };

  const handleRegisterSubmit = async () => {
    if (isLoading) return;
    Keyboard.dismiss();
    setLocalError(null);
    setFieldErrors({});
    clearAuthFeedback();

    const trimmedName = registerName.trim();
    const trimmedEmail = registerEmail.trim().toLowerCase();
    const nextFieldErrors = {};

    if (!trimmedName) {
      nextFieldErrors.name = 'Full name is required.';
    }
    if (!trimmedEmail || !EMAIL_REGEX.test(trimmedEmail)) {
      nextFieldErrors.email = 'Please enter a valid email address.';
    }
    if (registerPassword.length < 8) {
      nextFieldErrors.password =
        'Password must be at least 8 characters long.';
    }
    if (registerPassword !== registerConfirmPassword) {
      nextFieldErrors.confirmPassword = 'Passwords do not match.';
    }

    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      const firstError =
        nextFieldErrors.name ||
        nextFieldErrors.email ||
        nextFieldErrors.password ||
        nextFieldErrors.confirmPassword;
      setLocalError(firstError);
      return;
    }

    const result = await register({
      name: trimmedName,
      email: trimmedEmail,
      password: registerPassword,
      role: registerRole.trim() || 'QA Tester',
    });

    if (result && !result.ok && result.field) {
      setFieldErrors({ [result.field]: result.error });
    }
  };

  const activeError = localError
    ? formatAuthErrorMessage(localError, mode)
    : authError
    ? formatAuthErrorMessage(authError, mode)
    : null;

  const safeNotice = authNotice
    ? formatAuthErrorMessage({ status: 401, message: authNotice }, 'session')
    : null;

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
            <View style={styles.brandTextWrap}>
              <Text style={[styles.brandTitle, { color: colors.text }]}>
                Qavora
              </Text>
              <Text
                numberOfLines={1}
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
            hitSlop={8}
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
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 12}
      >
        <ScrollView
          ref={scrollViewRef}
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingBottom: isKeyboardVisible
                ? Math.max(keyboardHeight + 36, 180)
                : 36,
            },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
          showsVerticalScrollIndicator={true}
        >
          {/* Tap-outside area to dismiss software keyboard when tapping non-input regions */}
          <Pressable
            onPress={Keyboard.dismiss}
            accessible={false}
            style={styles.dismissTouchArea}
          >
            {/* Main Auth Card */}
            <View
              onLayout={(e) => {
                const y = e?.nativeEvent?.layout?.y;
                if (typeof y === 'number') {
                  authCardYRef.current = y;
                }
              }}
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
                  hitSlop={8}
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
              {safeNotice && !activeError ? (
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
                    {safeNotice}
                  </Text>
                </View>
              ) : null}

              {/* Top Error Banner */}
              {activeError ? (
                <View
                  accessibilityRole="alert"
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
                <View
                  onLayout={(e) => {
                    const y = e?.nativeEvent?.layout?.y;
                    if (typeof y === 'number') {
                      formSectionYRef.current = y;
                    }
                  }}
                  style={styles.formSection}
                >
                  {/* Login Email Field */}
                  <View
                    onLayout={(e) => recordFieldLayout('loginEmail', e)}
                    style={styles.fieldGroup}
                  >
                    <Text
                      style={[styles.fieldLabel, { color: colors.textSecondary }]}
                    >
                      Email Address
                    </Text>
                    <TextInput
                      ref={loginEmailInputRef}
                      value={loginEmail}
                      onChangeText={(val) => {
                        setLoginEmail(val);
                        clearFieldError('email');
                      }}
                      onFocus={() => handleFieldFocus('loginEmail')}
                      onBlur={() => handleFieldBlur('loginEmail')}
                      placeholder="tester@example.com"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="email-address"
                      inputMode="email"
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="email"
                      textContentType="emailAddress"
                      importantForAutofill="yes"
                      returnKeyType="next"
                      blurOnSubmit={false}
                      onSubmitEditing={() => {
                        if (loginPasswordInputRef.current) {
                          loginPasswordInputRef.current.focus();
                        }
                      }}
                      editable={!isLoading}
                      style={[
                        styles.input,
                        {
                          backgroundColor: colors.background,
                          borderColor: fieldErrors.email
                            ? colors.danger
                            : focusedField === 'loginEmail'
                            ? colors.primary
                            : colors.border,
                          color: colors.text,
                        },
                      ]}
                    />
                    {fieldErrors.email ? (
                      <Text
                        style={[styles.fieldErrorText, { color: colors.danger }]}
                      >
                        {fieldErrors.email}
                      </Text>
                    ) : null}
                  </View>

                  {/* Login Password Field */}
                  <View
                    onLayout={(e) => recordFieldLayout('loginPassword', e)}
                    style={styles.fieldGroup}
                  >
                    <View style={styles.passwordHeaderRow}>
                      <Text
                        style={[
                          styles.fieldLabel,
                          { color: colors.textSecondary },
                        ]}
                      >
                        Password
                      </Text>
                      <Pressable
                        onPress={() => setShowLoginPassword((prev) => !prev)}
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityLabel={
                          showLoginPassword ? 'Hide password' : 'Show password'
                        }
                        style={styles.headerTogglePassBtn}
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

                    <View
                      style={[
                        styles.passwordInputContainer,
                        {
                          backgroundColor: colors.background,
                          borderColor: fieldErrors.password
                            ? colors.danger
                            : focusedField === 'loginPassword'
                            ? colors.primary
                            : colors.border,
                        },
                      ]}
                    >
                      <TextInput
                        ref={loginPasswordInputRef}
                        value={loginPassword}
                        onChangeText={(val) => {
                          setLoginPassword(val);
                          clearFieldError('password');
                        }}
                        onFocus={() => handleFieldFocus('loginPassword')}
                        onBlur={() => handleFieldBlur('loginPassword')}
                        placeholder="Enter your password"
                        placeholderTextColor={colors.textMuted}
                        secureTextEntry={!showLoginPassword}
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoComplete="current-password"
                        textContentType="password"
                        importantForAutofill="yes"
                        returnKeyType="done"
                        blurOnSubmit={true}
                        onSubmitEditing={handleLoginSubmit}
                        editable={!isLoading}
                        style={[styles.passwordInputField, { color: colors.text }]}
                      />
                      <Pressable
                        onPress={() => setShowLoginPassword((prev) => !prev)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={
                          showLoginPassword ? 'Hide password' : 'Show password'
                        }
                        style={[
                          styles.inlinePasswordToggleBtn,
                          { borderLeftColor: colors.border },
                        ]}
                      >
                        <Text
                          style={[
                            styles.inlinePasswordToggleText,
                            { color: colors.primary, fontFamily: monoFontFamily },
                          ]}
                        >
                          {showLoginPassword ? 'Hide' : 'Show'}
                        </Text>
                      </Pressable>
                    </View>

                    {fieldErrors.password ? (
                      <Text
                        style={[styles.fieldErrorText, { color: colors.danger }]}
                      >
                        {fieldErrors.password}
                      </Text>
                    ) : null}
                  </View>

                  {/* Keep validation/auth error visible near submit button when keyboard is open */}
                  {activeError && isKeyboardVisible ? (
                    <View
                      style={[
                        styles.inlineSubmitErrorBox,
                        {
                          backgroundColor: colors.dangerSoft,
                          borderColor: colors.danger,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.inlineSubmitErrorText,
                          { color: colors.danger },
                        ]}
                      >
                        {activeError}
                      </Text>
                    </View>
                  ) : null}

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
                      <Text style={{ color: colors.primary, fontWeight: '700' }}>
                        Create Account
                      </Text>
                    </Text>
                  </Pressable>
                </View>
              ) : (
                /* REGISTER FORM */
                <View
                  onLayout={(e) => {
                    const y = e?.nativeEvent?.layout?.y;
                    if (typeof y === 'number') {
                      formSectionYRef.current = y;
                    }
                  }}
                  style={styles.formSection}
                >
                  {/* Register Full Name Field */}
                  <View
                    onLayout={(e) => recordFieldLayout('registerName', e)}
                    style={styles.fieldGroup}
                  >
                    <Text
                      style={[styles.fieldLabel, { color: colors.textSecondary }]}
                    >
                      Full Name
                    </Text>
                    <TextInput
                      ref={registerNameInputRef}
                      value={registerName}
                      onChangeText={(val) => {
                        setRegisterName(val);
                        clearFieldError('name');
                      }}
                      onFocus={() => handleFieldFocus('registerName')}
                      onBlur={() => handleFieldBlur('registerName')}
                      placeholder="Alex Rivera"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="default"
                      autoCapitalize="words"
                      autoComplete="name"
                      textContentType="name"
                      importantForAutofill="yes"
                      returnKeyType="next"
                      blurOnSubmit={false}
                      onSubmitEditing={() => {
                        if (registerEmailInputRef.current) {
                          registerEmailInputRef.current.focus();
                        }
                      }}
                      editable={!isLoading}
                      style={[
                        styles.input,
                        {
                          backgroundColor: colors.background,
                          borderColor: fieldErrors.name
                            ? colors.danger
                            : focusedField === 'registerName'
                            ? colors.primary
                            : colors.border,
                          color: colors.text,
                        },
                      ]}
                    />
                    {fieldErrors.name ? (
                      <Text
                        style={[styles.fieldErrorText, { color: colors.danger }]}
                      >
                        {fieldErrors.name}
                      </Text>
                    ) : null}
                  </View>

                  {/* Register Email Field */}
                  <View
                    onLayout={(e) => recordFieldLayout('registerEmail', e)}
                    style={styles.fieldGroup}
                  >
                    <Text
                      style={[styles.fieldLabel, { color: colors.textSecondary }]}
                    >
                      Email Address
                    </Text>
                    <TextInput
                      ref={registerEmailInputRef}
                      value={registerEmail}
                      onChangeText={(val) => {
                        setRegisterEmail(val);
                        clearFieldError('email');
                      }}
                      onFocus={() => handleFieldFocus('registerEmail')}
                      onBlur={() => handleFieldBlur('registerEmail')}
                      placeholder="alex.rivera@example.com"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="email-address"
                      inputMode="email"
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoComplete="email"
                      textContentType="emailAddress"
                      importantForAutofill="yes"
                      returnKeyType="next"
                      blurOnSubmit={false}
                      onSubmitEditing={() => {
                        if (registerPasswordInputRef.current) {
                          registerPasswordInputRef.current.focus();
                        }
                      }}
                      editable={!isLoading}
                      style={[
                        styles.input,
                        {
                          backgroundColor: colors.background,
                          borderColor: fieldErrors.email
                            ? colors.danger
                            : focusedField === 'registerEmail'
                            ? colors.primary
                            : colors.border,
                          color: colors.text,
                        },
                      ]}
                    />
                    {fieldErrors.email ? (
                      <Text
                        style={[styles.fieldErrorText, { color: colors.danger }]}
                      >
                        {fieldErrors.email}
                      </Text>
                    ) : null}
                  </View>

                  {/* QA Role Selector */}
                  <Text
                    style={[styles.fieldLabel, { color: colors.textSecondary }]}
                  >
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

                  {/* Register Password Field */}
                  <View
                    onLayout={(e) => recordFieldLayout('registerPassword', e)}
                    style={styles.fieldGroup}
                  >
                    <View style={styles.passwordHeaderRow}>
                      <Text
                        style={[
                          styles.fieldLabel,
                          { color: colors.textSecondary },
                        ]}
                      >
                        Password (minimum 8 characters)
                      </Text>
                      <Pressable
                        onPress={() => {
                          setShowRegisterPassword((prev) => {
                            const next = !prev;
                            setShowRegisterConfirmPassword(next);
                            return next;
                          });
                        }}
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityLabel={
                          showRegisterPassword ? 'Hide password' : 'Show password'
                        }
                        style={styles.headerTogglePassBtn}
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

                    <View
                      style={[
                        styles.passwordInputContainer,
                        {
                          backgroundColor: colors.background,
                          borderColor: fieldErrors.password
                            ? colors.danger
                            : focusedField === 'registerPassword'
                            ? colors.primary
                            : colors.border,
                        },
                      ]}
                    >
                      <TextInput
                        ref={registerPasswordInputRef}
                        value={registerPassword}
                        onChangeText={(val) => {
                          setRegisterPassword(val);
                          clearFieldError('password');
                        }}
                        onFocus={() => handleFieldFocus('registerPassword')}
                        onBlur={() => handleFieldBlur('registerPassword')}
                        placeholder="At least 8 characters"
                        placeholderTextColor={colors.textMuted}
                        secureTextEntry={!showRegisterPassword}
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoComplete="new-password"
                        textContentType="newPassword"
                        importantForAutofill="yes"
                        returnKeyType="next"
                        blurOnSubmit={false}
                        onSubmitEditing={() => {
                          if (registerConfirmPasswordInputRef.current) {
                            registerConfirmPasswordInputRef.current.focus();
                          }
                        }}
                        editable={!isLoading}
                        style={[styles.passwordInputField, { color: colors.text }]}
                      />
                      <Pressable
                        onPress={() =>
                          setShowRegisterPassword((prev) => !prev)
                        }
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={
                          showRegisterPassword ? 'Hide password' : 'Show password'
                        }
                        style={[
                          styles.inlinePasswordToggleBtn,
                          { borderLeftColor: colors.border },
                        ]}
                      >
                        <Text
                          style={[
                            styles.inlinePasswordToggleText,
                            { color: colors.primary, fontFamily: monoFontFamily },
                          ]}
                        >
                          {showRegisterPassword ? 'Hide' : 'Show'}
                        </Text>
                      </Pressable>
                    </View>

                    {fieldErrors.password ? (
                      <Text
                        style={[styles.fieldErrorText, { color: colors.danger }]}
                      >
                        {fieldErrors.password}
                      </Text>
                    ) : null}
                  </View>

                  {/* Register Confirm Password Field */}
                  <View
                    onLayout={(e) =>
                      recordFieldLayout('registerConfirmPassword', e)
                    }
                    style={styles.fieldGroup}
                  >
                    <View style={styles.passwordHeaderRow}>
                      <Text
                        style={[
                          styles.fieldLabel,
                          { color: colors.textSecondary },
                        ]}
                      >
                        Confirm Password
                      </Text>
                      <Pressable
                        onPress={() =>
                          setShowRegisterConfirmPassword((prev) => !prev)
                        }
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityLabel={
                          showRegisterConfirmPassword
                            ? 'Hide confirm password'
                            : 'Show confirm password'
                        }
                        style={styles.headerTogglePassBtn}
                      >
                        <Text
                          style={[
                            styles.togglePassText,
                            { color: colors.primary, fontFamily: monoFontFamily },
                          ]}
                        >
                          {showRegisterConfirmPassword ? 'Hide' : 'Show'}
                        </Text>
                      </Pressable>
                    </View>

                    <View
                      style={[
                        styles.passwordInputContainer,
                        {
                          backgroundColor: colors.background,
                          borderColor: fieldErrors.confirmPassword
                            ? colors.danger
                            : focusedField === 'registerConfirmPassword'
                            ? colors.primary
                            : colors.border,
                        },
                      ]}
                    >
                      <TextInput
                        ref={registerConfirmPasswordInputRef}
                        value={registerConfirmPassword}
                        onChangeText={(val) => {
                          setRegisterConfirmPassword(val);
                          clearFieldError('confirmPassword');
                        }}
                        onFocus={() =>
                          handleFieldFocus('registerConfirmPassword')
                        }
                        onBlur={() =>
                          handleFieldBlur('registerConfirmPassword')
                        }
                        placeholder="Re-enter your password"
                        placeholderTextColor={colors.textMuted}
                        secureTextEntry={!showRegisterConfirmPassword}
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoComplete="new-password"
                        textContentType="newPassword"
                        importantForAutofill="yes"
                        returnKeyType="done"
                        blurOnSubmit={true}
                        onSubmitEditing={handleRegisterSubmit}
                        editable={!isLoading}
                        style={[styles.passwordInputField, { color: colors.text }]}
                      />
                      <Pressable
                        onPress={() =>
                          setShowRegisterConfirmPassword((prev) => !prev)
                        }
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={
                          showRegisterConfirmPassword
                            ? 'Hide confirm password'
                            : 'Show confirm password'
                        }
                        style={[
                          styles.inlinePasswordToggleBtn,
                          { borderLeftColor: colors.border },
                        ]}
                      >
                        <Text
                          style={[
                            styles.inlinePasswordToggleText,
                            { color: colors.primary, fontFamily: monoFontFamily },
                          ]}
                        >
                          {showRegisterConfirmPassword ? 'Hide' : 'Show'}
                        </Text>
                      </Pressable>
                    </View>

                    {fieldErrors.confirmPassword ? (
                      <Text
                        style={[styles.fieldErrorText, { color: colors.danger }]}
                      >
                        {fieldErrors.confirmPassword}
                      </Text>
                    ) : null}
                  </View>

                  {/* Keep validation/auth error visible near submit button when keyboard is open */}
                  {activeError && isKeyboardVisible ? (
                    <View
                      style={[
                        styles.inlineSubmitErrorBox,
                        {
                          backgroundColor: colors.dangerSoft,
                          borderColor: colors.danger,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.inlineSubmitErrorText,
                          { color: colors.danger },
                        ]}
                      >
                        {activeError}
                      </Text>
                    </View>
                  ) : null}

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
                      <Text style={{ color: colors.primary, fontWeight: '700' }}>
                        Sign In
                      </Text>
                    </Text>
                  </Pressable>
                </View>
              )}
            </View>
          </Pressable>
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
    minHeight: 54,
    borderBottomWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  topBarInner: {
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  brandLockup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  brandTextWrap: {
    flex: 1,
    minWidth: 0,
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
    paddingHorizontal: 12,
    paddingTop: 18,
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
    flexGrow: 1,
  },
  dismissTouchArea: {
    flex: 1,
  },
  authCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
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
    minHeight: 32,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignItems: 'center',
    justifyContent: 'center',
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
    minHeight: 40,
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
  fieldGroup: {
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
    flexShrink: 1,
  },
  passwordHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  headerTogglePassBtn: {
    paddingVertical: 2,
    paddingHorizontal: 4,
    marginBottom: 4,
  },
  togglePassText: {
    fontSize: 12,
    fontWeight: '700',
  },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  passwordInputContainer: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  passwordInputField: {
    flex: 1,
    minHeight: 46,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  inlinePasswordToggleBtn: {
    minHeight: 46,
    minWidth: 58,
    paddingHorizontal: 12,
    borderLeftWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlinePasswordToggleText: {
    fontSize: 12,
    fontWeight: '700',
  },
  fieldErrorText: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 5,
    lineHeight: 16,
  },
  inlineSubmitErrorBox: {
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 10,
  },
  inlineSubmitErrorText: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
  },
  roleChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  roleChip: {
    minHeight: 36,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  submitBtn: {
    minHeight: 48,
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
    paddingVertical: 8,
  },
  switchLinkText: {
    fontSize: 13,
  },
});
