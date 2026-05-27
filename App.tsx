import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';
import { ScannerProvider } from './src/context/ScannerContext';
import ScanScreen from './src/screens/ScanScreen';

const Tab = createBottomTabNavigator();

export default function App() {
  return (
    <ScannerProvider>
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={{
            headerShown: false,
            tabBarStyle: { backgroundColor: '#111', borderTopColor: '#222' },
            tabBarActiveTintColor: '#42A5F5',
            tabBarInactiveTintColor: '#555',
          }}
        >
          <Tab.Screen
            name="Scan"
            component={ScanScreen}
            options={{ tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>📡</Text> }}
          />
        </Tab.Navigator>
      </NavigationContainer>
    </ScannerProvider>
  );
}
