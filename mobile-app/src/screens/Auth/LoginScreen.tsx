// ─────────────────────────────────────────────────────────────────────────────
// LoginScreen.tsx
//
// React Native equivalent of frontend/src/pages/Login.jsx
//
// Web parity:
//   • Fields  : email + password (both required)
//   • API     : POST /auth/login  →  loginUser(token, data)
//   • Errors  : same messages from API response
//   • Flow    : on success, RootNavigator auto-switches to Main stack
//
// Mobile additions:
//   • Same split-screen hero / white-sheet layout as SignupScreen
//   • Feather icons on inputs + button
//   • Animated entrance (sheet slides up)
//   • Spring-scale on button press
//   • Forgot Password placeholder
//   • KeyboardAvoidingView + ScrollView
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { AuthStackParamList } from '@/types/navigation'
import { useAuth } from '@/context/AuthContext'
import { login } from '@/api/auth'

const { height: SH } = Dimensions.get('window')
const HERO_H = SH * 0.34

// ── Design tokens (identical to SignupScreen) ─────────────────────────────────
const T = {
  p1: '#3DAF91',
  p2: '#2A9078',
  p3: '#1A6B5A',
  p4: '#0F4A3D',
  bg: '#FFFFFF',
  input: '#F8FAFB',
  border: '#E8ECF0',
  borderFocus: '#3DAF91',
  text: '#1A1F36',
  textSub: '#8F9BB3',
  textMuted: '#C0C8D8',
  error: '#E53935',
  errorBg: '#FFF5F5',
  white: '#FFFFFF',
}

// ── Reusable input field ──────────────────────────────────────────────────────
interface FieldProps {
  label: string
  placeholder: string
  value: string
  onChange: (v: string) => void
  icon: React.ReactNode
  secureTextEntry?: boolean
  keyboardType?: 'default' | 'email-address'
  autoCapitalize?: 'none' | 'words'
  returnKeyType?: 'next' | 'done'
  onSubmitEditing?: () => void
  blurOnSubmit?: boolean
  editable?: boolean
  inputRef?: React.RefObject<TextInput>
  right?: React.ReactNode
}

const Field: React.FC<FieldProps> = ({
  label, placeholder, value, onChange, icon,
  secureTextEntry, keyboardType = 'default',
  autoCapitalize = 'none', returnKeyType = 'next',
  onSubmitEditing, blurOnSubmit = false,
  editable = true, inputRef, right,
}) => {
  const [focused, setFocused] = useState(false)
  const borderAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.timing(borderAnim, {
      toValue: focused ? 1 : 0,
      duration: 180,
      useNativeDriver: false,
    }).start()
  }, [focused])

  const borderColor = borderAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [T.border, T.borderFocus],
  })

  return (
    <View style={fi.wrap}>
      <Text style={fi.label}>{label}</Text>
      <Animated.View style={[fi.row, { borderColor }]}>
        <View style={fi.iconWrap}>{icon}</View>
        <TextInput
          ref={inputRef as any}
          style={fi.input}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={T.textMuted}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          secureTextEntry={secureTextEntry}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          blurOnSubmit={blurOnSubmit}
          editable={editable}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          selectionColor={T.p1}
        />
        {right}
      </Animated.View>
    </View>
  )
}

const fi = StyleSheet.create({
  wrap:    { gap: 7 },
  label:   { fontSize: 13, fontWeight: '600', color: T.text, letterSpacing: 0.15 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    backgroundColor: T.input,
    paddingHorizontal: 14,
    gap: 10,
  },
  iconWrap: { width: 20, alignItems: 'center' },
  input:    { flex: 1, fontSize: 15, color: T.text, letterSpacing: 0.1 },
})

// ═════════════════════════════════════════════════════════════════════════════
type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>

export default function LoginScreen({ navigation }: Props) {
  const { loginUser } = useAuth()
  const insets = useSafeAreaInsets()

  // ── Form state ──────────────────────────────────────────────────────────────
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  // ── Entrance animation ──────────────────────────────────────────────────────
  const sheetY = useRef(new Animated.Value(60)).current
  const sheetO = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.parallel([
      Animated.timing(sheetY, { toValue: 0, duration: 550, useNativeDriver: true }),
      Animated.timing(sheetO, { toValue: 1, duration: 550, useNativeDriver: true }),
    ]).start()
  }, [])

  // ── Button spring ───────────────────────────────────────────────────────────
  const btnScale = useRef(new Animated.Value(1)).current
  const onIn  = () => Animated.spring(btnScale, { toValue: 0.975, useNativeDriver: true, speed: 30 }).start()
  const onOut = () => Animated.spring(btnScale, { toValue: 1,     useNativeDriver: true, speed: 20 }).start()

  const passwordRef = useRef<TextInput>(null)

  // ── Submit — same logic as web handleSubmit ─────────────────────────────────
  const handleSubmit = async () => {
    if (!email.trim())    { setError('Please enter your email address'); return }
    if (!password.trim()) { setError('Please enter your password'); return }

    setError('')
    setLoading(true)
    try {
      const res = await login({
        email:    email.trim().toLowerCase(),
        password: password.trim(),
      })
      // mirrors web: loginUser(res.data.token, res.data.data)
      await loginUser(res.data.token, res.data.data)
      // RootNavigator switches to Main stack automatically once token is set
    } catch (err: any) {
      setError(
        err?.response?.data?.message || 'Login failed. Please try again.'
      )
    } finally {
      setLoading(false)
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  return (
    <View style={s.root}>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <LinearGradient
        colors={[T.p4, T.p3, T.p2, T.p1]}
        locations={[0, 0.35, 0.7, 1]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={[s.hero, { paddingTop: insets.top + 20 }]}
      >
        {/* Logo mark */}
        <View style={s.logoMark}>
          <MaterialCommunityIcons name="office-building" size={26} color={T.p1} />
        </View>

        <Text style={s.heroTitle}>Welcome back</Text>
        <Text style={s.heroSub}>Your properties are waiting for you</Text>

        {/* Perks */}
        <View style={s.perks}>
          {[
            'Dashboard, exactly as you left it',
            'Instant access to all properties',
            'Secure and private, always',
          ].map((p) => (
            <View key={p} style={s.perkRow}>
              <Feather name="check-circle" size={13} color="rgba(255,255,255,0.55)" />
              <Text style={s.perkText}>{p}</Text>
            </View>
          ))}
        </View>
      </LinearGradient>

      {/* ── Sheet ────────────────────────────────────────────────────────── */}
      <KeyboardAvoidingView
        style={s.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Animated.View
          style={[s.sheet, { transform: [{ translateY: sheetY }], opacity: sheetO }]}
        >
          <ScrollView
            contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 32 }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={s.formTitle}>Sign in</Text>
            <Text style={s.formSub}>Enter your credentials to continue</Text>

            {/* Error */}
            {!!error && (
              <View style={s.errorBox}>
                <Feather name="alert-circle" size={14} color={T.error} />
                <Text style={s.errorText}>{error}</Text>
              </View>
            )}

            {/* Fields */}
            <View style={s.fields}>
              {/* Email */}
              <Field
                label="Email address"
                placeholder="you@example.com"
                value={email}
                onChange={(v) => { setEmail(v); setError('') }}
                icon={<Feather name="mail" size={17} color={T.textSub} />}
                keyboardType="email-address"
                returnKeyType="next"
                onSubmitEditing={() => passwordRef.current?.focus()}
                blurOnSubmit={false}
                editable={!loading}
              />

              {/* Password */}
              <View style={{ gap: 6 }}>
                <Field
                  label="Password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(v) => { setPassword(v); setError('') }}
                  icon={<Feather name="lock" size={17} color={T.textSub} />}
                  secureTextEntry={!showPass}
                  returnKeyType="done"
                  onSubmitEditing={handleSubmit}
                  editable={!loading}
                  inputRef={passwordRef}
                  right={
                    <Pressable onPress={() => setShowPass(v => !v)} hitSlop={12}>
                      <Feather
                        name={showPass ? 'eye-off' : 'eye'}
                        size={18}
                        color={T.textSub}
                      />
                    </Pressable>
                  }
                />

                {/* Forgot password */}
                <TouchableOpacity
                  style={s.forgotBtn}
                  activeOpacity={0.7}
                  onPress={() => {
                    // Placeholder — implement ForgotPassword screen in next step
                  }}
                >
                  <Text style={s.forgotText}>Forgot password?</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Submit */}
            <Animated.View style={[s.btnWrap, { transform: [{ scale: btnScale }] }]}>
              <TouchableOpacity
                onPress={handleSubmit}
                onPressIn={onIn}
                onPressOut={onOut}
                disabled={loading}
                activeOpacity={1}
              >
                <LinearGradient
                  colors={[T.p1, T.p3]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={[s.btn, loading && s.btnDisabled]}
                >
                  {loading ? (
                    <ActivityIndicator color={T.white} />
                  ) : (
                    <View style={s.btnInner}>
                      <Text style={s.btnText}>Sign in</Text>
                      <View style={s.btnArrow}>
                        <Feather name="arrow-right" size={18} color={T.p1} />
                      </View>
                    </View>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </Animated.View>

            {/* Trust */}
            <View style={s.trustRow}>
              <Feather name="shield" size={13} color={T.textMuted} />
              <Text style={s.trustText}>256-bit SSL encrypted · Your data is safe</Text>
            </View>

            {/* Divider */}
            <View style={s.divider}>
              <View style={s.divLine} />
              <Text style={s.divText}>or</Text>
              <View style={s.divLine} />
            </View>

            {/* Sign up */}
            <TouchableOpacity
              style={s.signupBtn}
              onPress={() => navigation.navigate('Signup')}
              activeOpacity={0.7}
            >
              <Text style={s.signupText}>Don't have an account?  </Text>
              <Text style={s.signupLink}>Sign up</Text>
            </TouchableOpacity>

          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>

    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.p4 },

  // ── Hero ──────────────────────────────────────────────────────────────────
  hero: {
    height: HERO_H,
    paddingHorizontal: 28,
    justifyContent: 'center',
    gap: 5,
  },
  logoMark: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  heroTitle: { fontSize: 26, fontWeight: '800', color: T.white, letterSpacing: -0.5 },
  heroSub:   { fontSize: 14, color: 'rgba(255,255,255,0.6)', marginTop: 2, marginBottom: 18 },

  // Perks
  perks:   { gap: 8 },
  perkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  perkText:{ fontSize: 13, color: 'rgba(255,255,255,0.55)', lineHeight: 18 },

  // ── Sheet ─────────────────────────────────────────────────────────────────
  kav:   { flex: 1, marginTop: -24 },
  sheet: {
    flex: 1,
    backgroundColor: T.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 10,
  },
  scroll: { paddingHorizontal: 24, paddingTop: 28 },

  formTitle: { fontSize: 24, fontWeight: '800', color: T.text, letterSpacing: -0.4 },
  formSub:   { fontSize: 14, color: T.textSub, marginTop: 4, marginBottom: 24 },

  // ── Error ─────────────────────────────────────────────────────────────────
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: T.errorBg,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(229,57,53,0.15)',
  },
  errorText: { flex: 1, fontSize: 13, color: T.error, lineHeight: 18 },

  // ── Fields ────────────────────────────────────────────────────────────────
  fields: { gap: 16 },

  // ── Forgot ────────────────────────────────────────────────────────────────
  forgotBtn:  { alignSelf: 'flex-end' },
  forgotText: { fontSize: 13, fontWeight: '600', color: T.p1 },

  // ── Button ────────────────────────────────────────────────────────────────
  btnWrap: { marginTop: 24 },
  btn: {
    height: 54,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: T.p2,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 6,
  },
  btnDisabled: { opacity: 0.6 },
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  btnText:  { fontSize: 16, fontWeight: '700', color: T.white, letterSpacing: 0.2 },
  btnArrow: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: T.white,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ── Trust ─────────────────────────────────────────────────────────────────
  trustRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
  },
  trustText: { fontSize: 12, color: T.textMuted },

  // ── Divider ───────────────────────────────────────────────────────────────
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 24 },
  divLine: { flex: 1, height: 1, backgroundColor: T.border },
  divText: { fontSize: 13, color: T.textSub },

  // ── Sign up ───────────────────────────────────────────────────────────────
  signupBtn:  { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 16 },
  signupText: { fontSize: 14, color: T.textSub },
  signupLink: { fontSize: 14, fontWeight: '700', color: T.p1 },
})
