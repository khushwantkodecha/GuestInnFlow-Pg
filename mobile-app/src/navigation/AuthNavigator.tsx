// ─────────────────────────────────────────────────────────────────────────────
// AuthNavigator — stack for unauthenticated users (Signup + Login).
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { AuthStackParamList } from '@/types/navigation'
import SignupScreen from '@/screens/Auth/SignupScreen'
import LoginScreen  from '@/screens/Auth/LoginScreen'

const Stack = createNativeStackNavigator<AuthStackParamList>()

const AuthNavigator: React.FC = () => {
  return (
    <Stack.Navigator
      // Login is the default — users returning to the app land here.
      // Signup is reachable via the "Sign up" link on Login.
      initialRouteName="Login"
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        animationDuration: 180,
      }}
    >
      {/* Login must be declared first so it renders without any flash */}
      <Stack.Screen name="Login"  component={LoginScreen}  />
      <Stack.Screen name="Signup" component={SignupScreen} />
    </Stack.Navigator>
  )
}

export default AuthNavigator
