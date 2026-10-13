/**
 * Tela de erro: envolve o app inteiro. Mostra o erro que fecharia o app (ou o
 * que fechou o app da última vez, gravado pelo lado nativo) com um botão para
 * compartilhar o texto. Só usa React Native, de propósito.
 */
import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import {
  clearCrash,
  crashReport,
  currentCrash,
  reportCrash,
  reportPreviousCrash,
  subscribeCrash,
  toCrashInfo,
  type CrashInfo,
} from './state';

/** Gravado pelo MainApplication (plugins/withCrashLog.js) quando o app fecha por um erro nativo. */
const NATIVE_CRASH_FILE = 'last-crash.txt';

function takePreviousCrash(): string | null {
  try {
    // Carregado só aqui: a tela de erro não pode depender de um módulo nativo que talvez seja o problema.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
    const file = new File(Paths.document, NATIVE_CRASH_FILE);
    if (!file.exists) return null;
    const text = file.textSync();
    file.delete();
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

function hideSplash() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('expo-router/build/utils/splash') as { hide(): void }).hide();
  } catch {
    // Sem a tela de abertura: nada a esconder.
  }
}

interface State {
  crash: CrashInfo | null;
}

export class CrashGate extends Component<{ children: ReactNode }, State> {
  state: State = { crash: currentCrash() };
  private unsubscribe: (() => void) | null = null;

  static getDerivedStateFromError(error: unknown): State {
    return { crash: toCrashInfo(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportCrash(error, info.componentStack ?? undefined);
  }

  componentDidMount() {
    this.unsubscribe = subscribeCrash((crash) => this.setState({ crash }));
    if (!this.state.crash) {
      const previous = takePreviousCrash();
      if (previous) reportPreviousCrash(previous);
    }
  }

  componentWillUnmount() {
    this.unsubscribe?.();
  }

  private dismiss = () => {
    clearCrash();
    this.setState({ crash: null });
  };

  render() {
    const { crash } = this.state;
    if (!crash) return this.props.children;
    return <CrashScreen crash={crash} onDismiss={this.dismiss} />;
  }
}

function CrashScreen({ crash, onDismiss }: { crash: CrashInfo; onDismiss: () => void }) {
  useEffect(hideSplash, []);
  const previous = crash.kind === 'previous';
  const share = () => {
    Share.share({ message: crashReport(crash) }).catch(() => {});
  };
  return (
    <View style={styles.root}>
      <Text style={styles.title} accessibilityRole="header">
        {previous ? "O Ledit's fechou da última vez" : "O Ledit's encontrou um erro"}
      </Text>
      <Text style={styles.text}>
        Toque em Compartilhar erro e mande o texto para quem está corrigindo o app. Ele diz exatamente onde o problema
        aconteceu.
      </Text>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={share} style={({ pressed }) => [styles.primary, pressed && styles.pressed]}>
          <Text style={styles.primaryLabel}>Compartilhar erro</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onDismiss} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
          <Text style={styles.secondaryLabel}>{previous ? 'Continuar' : 'Tentar de novo'}</Text>
        </Pressable>
      </View>
      <ScrollView style={styles.box} contentContainerStyle={{ padding: 12 }}>
        <Text selectable style={styles.message}>
          {crash.message}
        </Text>
        <Text selectable style={styles.details}>
          {crash.details}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0c0f', paddingTop: 56, paddingHorizontal: 16, paddingBottom: 24, gap: 12 },
  title: { color: '#f4f5f7', fontSize: 22, fontWeight: '700' },
  text: { color: '#a4aab5', fontSize: 15, lineHeight: 21 },
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  primary: { backgroundColor: '#ffb547', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12 },
  primaryLabel: { color: '#1a1204', fontSize: 15, fontWeight: '700' },
  secondary: { borderColor: '#737a87', borderWidth: 1, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12 },
  secondaryLabel: { color: '#f4f5f7', fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.7 },
  box: { flex: 1, backgroundColor: '#16181d', borderRadius: 10 },
  message: { color: '#ff6b6b', fontSize: 14, fontWeight: '600', marginBottom: 8 },
  details: { color: '#f4f5f7', fontSize: 12, fontFamily: 'monospace' },
});
