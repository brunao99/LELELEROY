/**
 * Painel do laço na colagem: as mesmas ferramentas do recorte de vídeo (laço,
 * incluir, excluir), terminando numa figurinha em vez de rastrear um clipe.
 */
import { Lasso, MinusCircle, PlusCircle, Undo2 } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { useCutoutEditor, type CutoutTool } from '@/features/editor/cutout/store';
import { Button, Row } from '@/ui/Button';
import { ChoiceRow } from '@/ui/Chip';
import { Panel, SectionLabel } from '@/ui/Panel';
import { Txt } from '@/ui/Text';
import { colors, space } from '@/ui/theme';

export function StickerLassoPanel({ onCreate }: { onCreate: () => void }) {
  const phase = useCutoutEditor((s) => s.phase);
  const tool = useCutoutEditor((s) => s.tool);
  const hasResult = useCutoutEditor((s) => !!s.mask);
  const clicks = useCutoutEditor((s) => s.clicks.length);
  const lassoDrawn = useCutoutEditor((s) => s.lasso.length > 0);
  const { setTool, undo, close } = useCutoutEditor.getState();
  const busy = phase === 'opening' || phase === 'thinking' || phase === 'saving';

  return (
    <Panel title="Figurinha" onDone={hasResult ? onCreate : close}>
      <SectionLabel>Ferramenta</SectionLabel>
      <ChoiceRow<CutoutTool>
        options={[
          { value: 'lasso', label: 'Laço' },
          { value: 'include', label: 'Incluir' },
          { value: 'exclude', label: 'Excluir' },
        ]}
        value={tool}
        onChange={(t) => (t === 'lasso' || hasResult) && setTool(t)}
      />
      <View style={styles.tips}>
        <Tip icon={Lasso} text="Contorne o objeto. Não precisa ser exato: a IA acha a borda." />
        <Tip icon={PlusCircle} color={colors.success} text="Incluir: toque numa parte que ficou de fora." />
        <Tip icon={MinusCircle} color={colors.danger} text="Excluir: toque numa parte que entrou sem querer." />
      </View>
      <Row style={{ paddingHorizontal: space[4] }}>
        <Button label="Criar figurinha" onPress={onCreate} disabled={!hasResult || busy} loading={phase === 'saving'} />
        <Button label="Desfazer" icon={Undo2} variant="secondary" onPress={undo} disabled={busy || (!lassoDrawn && clicks === 0)} />
        <Button label="Cancelar" variant="ghost" onPress={close} />
      </Row>
    </Panel>
  );
}

function Tip({ icon: Icon, text, color = colors.accent }: { icon: typeof Lasso; text: string; color?: string }) {
  return (
    <View style={styles.tip}>
      <Icon size={16} color={color} />
      <Txt variant="xs" tone="muted" style={{ flex: 1 }}>
        {text}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  tips: { paddingHorizontal: space[4], gap: space[2] },
  tip: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
});
