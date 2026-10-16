/**
 * Abas da tela inicial: Criar, Colagem e Meus projetos. São telas irmãs, então
 * trocar de aba não anima (sem deslizar, que daria ideia de profundidade).
 */
import { Tabs } from 'expo-router';
import { LayoutDashboard, LayoutGrid, Plus } from 'lucide-react-native';
import { StyleSheet } from 'react-native';

import { colors } from '@/ui/theme';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        animation: 'none',
        sceneStyle: { backgroundColor: colors.bg },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Criar', tabBarIcon: ({ color, size }) => <Plus color={color} size={size} /> }} />
      <Tabs.Screen
        name="colagem"
        options={{ title: 'Colagem', tabBarIcon: ({ color, size }) => <LayoutDashboard color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="projetos"
        options={{ title: 'Meus projetos', tabBarIcon: ({ color, size }) => <LayoutGrid color={color} size={size} /> }}
      />
    </Tabs>
  );
}
