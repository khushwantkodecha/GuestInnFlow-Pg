// ─────────────────────────────────────────────────────────────────────────────
// RootNavigator — decides whether to show Auth or Main stack based on token.
// This is the React Native equivalent of the web app's PrivateRoute pattern.
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react'
import { View, ActivityIndicator, StyleSheet } from 'react-native'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { useAuth } from '@/context/AuthContext'
import AuthNavigator from './AuthNavigator'
import { COLORS } from '@/constants/config'

// Placeholder main screen — replace with real MainNavigator in future steps
import { Text } from 'react-native'
const PlaceholderDashboard: React.FC = () => (
  <View style={styles.placeholder}>
    <Text style={styles.placeholderText}>Dashboard — coming soon</Text>
  </View>
)

const Root = createNativeStackNavigator()

const RootNavigator: React.FC = () => {
  const { token, isLoading } = useAuth()

  // Show a full-screen spinner while AsyncStorage is being read on app start
  if (isLoading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    )
  }

  return (
    <NavigationContainer>
      <Root.Navigator screenOptions={{ headerShown: false }}>
        {token ? (
          <Root.Screen name="Main" component={PlaceholderDashboard} />
        ) : (
          <Root.Screen name="Auth" component={AuthNavigator} />
        )}
      </Root.Navigator>
    </NavigationContainer>
  )
}

export default RootNavigator

const styles = StyleSheet.create({
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  placeholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  placeholderText: {
    fontSize: 18,
    color: COLORS.textMuted,
  },
})
