import React, { useRef, useState, useEffect } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Animated,
  Pressable,
  Dimensions,
} from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { NativeStackScreenProps } from '@react-navigation/native-stack'
import { AuthStackParamList } from '@/types/navigation'
import { useAuth } from '@/context/AuthContext'
import { signup } from '@/api/auth'

const { height: SH } = Dimensions.get('window')

// ── Tokens ────────────────────────────────────────────────────────────────────
const T = {
  p1: '#3DAF91',   // primary teal
  p2: '#2A9078',   // primary dark
  p3: '#1A6B5A',   // primary deep (for gradient start)
  p4: '#0F4A3D',   // deepest
  bg: '#FFFFFF',
  surface: '#FFFFFF',
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

// ── Password strength ─────────────────────────────────────────────────────────
function getStrength(p: string) {
  if (!p) return null
  let s = 0
  if (p.length >= 6)           s++
  if (p.length >= 10)          s++
  if (/[A-Z]/.test(p))        s++
  if (/[0-9]/.test(p))        s++
  if (/[^A-Za-z0-9]/.test(p)) s++
  if (s <= 1) return { bars: 1, label: 'Weak',   color: '#F44336' }
  if (s <= 2) return { bars: 2, label: 'Fair',   color: '#FF9800' }
  if (s <= 3) return { bars: 3, label: 'Good',   color: '#4CAF50' }
  return              { bars: 4, label: 'Strong', color: '#00BFA5' }
}

// ── Input field ───────────────────────────────────────────────────────────────
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
type Props = NativeStackScreenProps<AuthStackParamList, 'Signup'>

export default function SignupScreen({ navigation }: Props) {
  const { loginUser } = useAuth()
  const insets = useSafeAreaInsets()

  const [name,     setName]     = useState('')
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  // Sheet slide-up
  const sheetY = useRef(new Animated.Value(60)).current
  const sheetO = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.parallel([
      Animated.timing(sheetY, { toValue: 0, duration: 550, useNativeDriver: true }),
      Animated.timing(sheetO, { toValue: 1, duration: 550, useNativeDriver: true }),
    ]).start()
  }, [])

  // Button press
  const btnScale = useRef(new Animated.Value(1)).current
  const onIn  = () => Animated.spring(btnScale, { toValue: 0.975, useNativeDriver: true, speed: 30 }).start()
  const onOut = () => Animated.spring(btnScale, { toValue: 1,     useNativeDriver: true, speed: 20 }).start()

  // Strength
  const strength = getStrength(password)

  const emailRef    = useRef<TextInput>(null)
  const passwordRef = useRef<TextInput>(null)

  const handleSubmit = async () => {
    if (!name.trim())                 { setError('Please enter your full name'); return }
    if (!email.trim())                { setError('Please enter your email'); return }
    if (!/\S+@\S+\.\S+/.test(email)) { setError('Please enter a valid email'); return }
    if (password.length < 6)         { setError('Password must be at least 6 characters'); return }

    setError('')
    setLoading(true)
    try {
      const res = await signup({ name: name.trim(), email: email.trim().toLowerCase(), password })
      await loginUser(res.data.token, res.data.data)
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Signup failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={s.root}>

      {/* ── Hero: top teal section ───────────────────────────────────────── */}
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

        <Text style={s.heroTitle}>GuestInnFlow</Text>
        <Text style={s.heroSub}>Smart PG management platform</Text>

      </LinearGradient>

      {/* ── Sheet: white bottom card ─────────────────────────────────────── */}
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

            <Text style={s.formTitle}>Create account</Text>
            <Text style={s.formSub}>Fill in the details below to get started</Text>

            {/* Error */}
            {!!error && (
              <View style={s.errorBox}>
                <Feather name="alert-circle" size={14} color={T.error} />
                <Text style={s.errorText}>{error}</Text>
              </View>
            )}

            {/* Fields */}
            <View style={s.fields}>
              <Field
                label="Full Name"
                placeholder="Rahul Sharma"
                value={name}
                onChange={(v) => { setName(v); setError('') }}
                icon={<Feather name="user" size={17} color={T.textSub} />}
                autoCapitalize="words"
                returnKeyType="next"
                onSubmitEditing={() => emailRef.current?.focus()}
                blurOnSubmit={false}
                editable={!loading}
              />

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
                inputRef={emailRef}
              />

              <View style={{ gap: 10 }}>
                <Field
                  label="Password"
                  placeholder="Min. 6 characters"
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

                {/* Strength meter */}
                {strength && (
                  <View style={s.strengthRow}>
                    <View style={s.strengthBars}>
                      {[1, 2, 3, 4].map(n => (
                        <View
                          key={n}
                          style={[
                            s.strengthBar,
                            { backgroundColor: n <= strength.bars ? strength.color : T.border },
                          ]}
                        />
                      ))}
                    </View>
                    <Text style={[s.strengthLabel, { color: strength.color }]}>
                      {strength.label}
                    </Text>
                  </View>
                )}
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
                  style={s.btn}
                >
                  {loading ? (
                    <ActivityIndicator color={T.white} />
                  ) : (
                    <View style={s.btnInner}>
                      <Text style={s.btnText}>Create account</Text>
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

            {/* Sign in */}
            <TouchableOpacity
              style={s.signinBtn}
              onPress={() => navigation.navigate('Login')}
              activeOpacity={0.7}
            >
              <Text style={s.signinText}>Already have an account?  </Text>
              <Text style={s.signinLink}>Sign in</Text>
            </TouchableOpacity>

          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>

    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
const HERO_H = SH * 0.34

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.p4 },

  // Hero
  hero: {
    height: HERO_H,
    paddingHorizontal: 28,
    justifyContent: 'center',
    gap: 6,
  },
  logoMark: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  heroTitle: { fontSize: 26, fontWeight: '800', color: T.white, letterSpacing: -0.5 },
  heroSub:   { fontSize: 14, color: 'rgba(255,255,255,0.65)', marginTop: 2 },

  // Stats
  statsRow: {
    flexDirection: 'row',
    marginTop: 22,
    backgroundColor: 'rgba(0,0,0,0.18)',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  statItem:    { flex: 1, alignItems: 'center' },
  statValue:   { fontSize: 17, fontWeight: '800', color: T.white },
  statLabel:   { fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 2 },
  statDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.15)', marginVertical: 2 },

  // Sheet
  kav:   { flex: 1, marginTop: -24 },
  sheet: {
    flex: 1,
    backgroundColor: T.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 10,
  },
  scroll: {
    paddingHorizontal: 24,
    paddingTop: 8,
  },

  handle: {
    width: 40, height: 4,
    borderRadius: 2,
    backgroundColor: '#E0E4EC',
    alignSelf: 'center',
    marginBottom: 24,
    marginTop: 10,
  },

  formTitle: { fontSize: 24, fontWeight: '800', color: T.text, letterSpacing: -0.4 },
  formSub:   { fontSize: 14, color: T.textSub, marginTop: 4, marginBottom: 20 },

  // Error
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: T.errorBg,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: 'rgba(229,57,53,0.15)',
  },
  errorText: { flex: 1, fontSize: 13, color: T.error, lineHeight: 18 },

  // Fields
  fields: { gap: 16 },

  // Strength
  strengthRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 2 },
  strengthBars: { flex: 1, flexDirection: 'row', gap: 4 },
  strengthBar:  { flex: 1, height: 4, borderRadius: 2 },
  strengthLabel:{ fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', width: 48, textAlign: 'right' },

  // Button
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
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  btnText:  { fontSize: 16, fontWeight: '700', color: T.white, letterSpacing: 0.2 },
  btnArrow: {
    width: 30, height: 30,
    borderRadius: 10,
    backgroundColor: T.white,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Trust
  trustRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginTop: 14 },
  trustText: { fontSize: 12, color: T.textMuted },

  // Divider
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 24 },
  divLine: { flex: 1, height: 1, backgroundColor: T.border },
  divText: { fontSize: 13, color: T.textSub },

  // Sign in
  signinBtn:  { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 16 },
  signinText: { fontSize: 14, color: T.textSub },
  signinLink: { fontSize: 14, fontWeight: '700', color: T.p1 },
})
