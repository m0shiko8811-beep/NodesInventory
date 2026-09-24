import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Text } from 'react-native';
import { ScannerProvider } from './src/context/ScannerContext';
import type { JobStackParamList } from './src/navigation/types';
import ScanScreen from './src/screens/ScanScreen';
import MapScreen from './src/screens/MapScreen';
import JobHomeScreen from './src/screens/JobHomeScreen';
import PreDeployScreen from './src/screens/PreDeployScreen';
import PickupScreen from './src/screens/PickupScreen';
import ReportScreen from './src/screens/ReportScreen';

const Tab = createBottomTabNavigator();
const JobStack = createNativeStackNavigator<JobStackParamList>();

function JobsNavigator() {
  return (
    <JobStack.Navigator screenOptions={{ headerShown: false }}>
      <JobStack.Screen name="JobHome" component={JobHomeScreen} />
      <JobStack.Screen name="PreDeploy" component={PreDeployScreen} />
      <JobStack.Screen name="Pickup" component={PickupScreen} />
      <JobStack.Screen name="Report" component={ReportScreen} />
    </JobStack.Navigator>
  );
}

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
          <Tab.Screen
            name="Map"
            component={MapScreen}
            options={{ tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>🗺️</Text> }}
          />
          <Tab.Screen
            name="Jobs"
            component={JobsNavigator}
            options={{ tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>&#128203;</Text> }}
          />
        </Tab.Navigator>
      </NavigationContainer>
    </ScannerProvider>
  );
}
