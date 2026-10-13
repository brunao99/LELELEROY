import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Button } from './Button';
import { ProgressBar } from './Feedback';
import { Txt } from './Text';
import { colors, radius, space } from './theme';

export interface PromptProps {
  visible: boolean;
  title: string;
  initial: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}

/** Campo de texto num diálogo (renomear). O Alert.prompt só existe no iOS. */
export function PromptDialog(props: PromptProps) {
  // Remonta a cada abertura: o campo começa sempre com o valor atual.
  return props.visible ? <PromptBody key={props.initial} {...props} /> : null;
}

function PromptBody({ visible, title, initial, confirmLabel = 'Salvar', onCancel, onConfirm }: PromptProps) {
  const [value, setValue] = useState(initial);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityLabel="Fechar" />
        <View style={styles.box}>
          <Txt variant="lg" accessibilityRole="header">
            {title}
          </Txt>
          <TextInput
            value={value}
            onChangeText={setValue}
            autoFocus
            selectTextOnFocus
            style={styles.input}
            placeholderTextColor={colors.textFaint}
            accessibilityLabel={title}
            returnKeyType="done"
            onSubmitEditing={() => value.trim() && onConfirm(value)}
          />
          <View style={styles.actions}>
            <Button label="Cancelar" variant="ghost" onPress={onCancel} />
            <Button label={confirmLabel} onPress={() => onConfirm(value)} disabled={!value.trim()} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Bloqueia a tela durante um trabalho com progresso (importar mídias). */
export function ProgressDialog({ visible, title, fraction, detail }: { visible: boolean; title: string; fraction: number | null; detail?: string }) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.scrim}>
        <View style={styles.box} accessibilityLiveRegion="polite">
          <Txt variant="lg">{title}</Txt>
          {detail ? (
            <Txt variant="sm" tone="muted">
              {detail}
            </Txt>
          ) : null}
          <ProgressBar fraction={fraction} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: space[6] },
  box: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space[5], gap: space[4] },
  input: {
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderInput,
    color: colors.text,
    paddingHorizontal: space[3],
    fontSize: 15,
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space[2] },
});
