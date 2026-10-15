/**
 * Configurações (S20): espaço usado, limpar caches, modelos de legenda e licenças.
 */
import { Directory } from 'expo-file-system';
import { useFocusEffect, useRouter } from 'expo-router';
import { ArrowLeft, Trash2 } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { WHISPER_MODELS } from '@/core/captions';
import { deleteModel, isModelReady, modelFile } from '@/engine/captions';
import { exportsDir, projectsRoot } from '@/storage/paths';
import { directorySize } from '@/storage/projects';
import { Button, IconButton } from '@/ui/Button';
import { SectionLabel } from '@/ui/Panel';
import { Txt } from '@/ui/Text';
import { colors, radius, space } from '@/ui/theme';

function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1).replace('.', ',')} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2).replace('.', ',')} GB`;
}

/** Caches que podem ser apagados: miniaturas, formas de onda, cópias aceleradas e áudios processados. */
const CACHE_DIRS = ['thumbs', 'peaks', 'baked', 'rendered'];

function cacheSize(): number {
  const root = projectsRoot();
  if (!root.exists) return 0;
  let total = 0;
  for (const entry of root.list()) {
    if (!(entry instanceof Directory)) continue;
    for (const name of CACHE_DIRS) total += directorySize(new Directory(entry, name));
  }
  return total;
}

function clearCaches() {
  const root = projectsRoot();
  if (!root.exists) return;
  for (const entry of root.list()) {
    if (!(entry instanceof Directory)) continue;
    for (const name of CACHE_DIRS) {
      const dir = new Directory(entry, name);
      if (dir.exists) dir.delete();
    }
  }
  const exports = exportsDir();
  if (exports.exists) exports.delete();
}

const FONT_LICENSES = [
  'Inter (OFL)',
  'Montserrat (OFL)',
  'Bebas Neue (OFL)',
  'Oswald (OFL)',
  'Roboto Slab (Apache 2.0)',
  'Lobster (OFL)',
  'Pacifico (OFL)',
  'Permanent Marker (Apache 2.0)',
];

export default function Settings() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [sizes, setSizes] = useState({ projects: 0, cache: 0, exports: 0 });
  const [, setTick] = useState(0);

  const refresh = useCallback(() => {
    setSizes({ projects: directorySize(projectsRoot()), cache: cacheSize(), exports: directorySize(exportsDir()) });
    setTick((t) => t + 1);
  }, []);
  useFocusEffect(refresh);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <IconButton icon={ArrowLeft} label="Voltar" onPress={() => router.back()} />
        <Txt variant="lg" accessibilityRole="header">
          Configurações
        </Txt>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space[6] }]}>
        <SectionLabel>Armazenamento</SectionLabel>
        <View style={styles.card}>
          <Row label="Projetos (com as mídias copiadas)" value={formatBytes(sizes.projects)} />
          <Row label="Caches (miniaturas, velocidade, áudio)" value={formatBytes(sizes.cache)} />
          <Row label="Vídeos exportados (cópias internas)" value={formatBytes(sizes.exports)} />
          <Button
            label="Limpar caches"
            icon={Trash2}
            variant="secondary"
            onPress={() =>
              Alert.alert('Limpar caches?', 'Os projetos continuam iguais. Miniaturas, velocidades e áudios processados são refeitos quando você abrir cada projeto.', [
                { text: 'Cancelar', style: 'cancel' },
                {
                  text: 'Limpar',
                  style: 'destructive',
                  onPress: () => {
                    clearCaches();
                    refresh();
                  },
                },
              ])
            }
          />
        </View>

        <SectionLabel>Legendas automáticas</SectionLabel>
        <View style={styles.card}>
          {WHISPER_MODELS.map((m) => (
            <View key={m.id} style={styles.modelRow}>
              <View style={{ flex: 1 }}>
                <Txt variant="sm">Modelo {m.name}</Txt>
                <Txt variant="xs" tone="muted">
                  {isModelReady(m) ? `Baixado · ${formatBytes(modelFile(m).size ?? 0)}` : `Não baixado · ${m.megabytes} MB`}
                </Txt>
              </View>
              {isModelReady(m) ? (
                <Button
                  label="Apagar"
                  size="sm"
                  variant="ghost"
                  onPress={() => {
                    deleteModel(m);
                    refresh();
                  }}
                />
              ) : null}
            </View>
          ))}
          <Txt variant="xs" tone="muted">
            Os modelos são do whisper.cpp (licença MIT) e rodam no aparelho. O áudio nunca sai do celular.
          </Txt>
        </View>

        <SectionLabel>Sobre</SectionLabel>
        <View style={styles.card}>
          <Txt variant="sm">{"Ledit's 0.1.0 · projeto pessoal"}</Txt>
          <Txt variant="xs" tone="muted">
            Fontes do texto: {FONT_LICENSES.join(', ')}. Ícones: Lucide (ISC). Motor de vídeo: React Native Skia e
            react-native-skia-video (MIT). Reconhecimento de fala: whisper.cpp (MIT) e detector de voz Silero (MIT).
            MP3: lamejs (LGPL-3.0).
          </Txt>
        </View>
      </ScrollView>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Txt variant="sm" style={{ flex: 1 }}>
        {label}
      </Txt>
      <Txt variant="sm" weight="600" tabular>
        {value}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', gap: space[2], paddingLeft: space[1] },
  content: { gap: space[3], paddingTop: space[2] },
  card: { marginHorizontal: space[4], padding: space[4], borderRadius: radius.lg, backgroundColor: colors.surface, gap: space[3] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  modelRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
});
