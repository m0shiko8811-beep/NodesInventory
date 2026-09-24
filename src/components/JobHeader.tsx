import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export interface JobHeaderProps {
  title: string;
  subtitle?: string;
}

export default function JobHeader({ title, subtitle }: JobHeaderProps) {
  return (
    <View style={styles.header}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: '#1A237E',
    padding: 16,
    paddingTop: 20,
  },
  title: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  subtitle: { color: '#90CAF9', fontSize: 13, marginTop: 2 },
});
