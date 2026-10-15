import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import { memo, useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { displaySize } from '@/core/geometry';
import type { MediaAsset, Micros } from '@/core/types';
import { PEAKS_PER_SECOND, thumbTime, thumbnail, waveform } from '@/engine/mediaCache';
import { colors } from '@/ui/theme';

const MAX_TILES = 40;

/** Miniaturas lado a lado dentro de um clipe da timeline. */
export const Filmstrip = memo(function Filmstrip({
  projectId,
  asset,
  sourceIn,
  sourceOut,
  speed,
  reverse,
  width,
  height,
  pps,
}: {
  projectId: string;
  asset: MediaAsset;
  sourceIn: Micros;
  sourceOut: Micros;
  speed: number;
  reverse: boolean;
  width: number;
  height: number;
  pps: number;
}) {
  const size = displaySize(asset);
  const tileW = Math.max(24, Math.min(height * 1.8, height * (size.width / Math.max(1, size.height))));
  const count = Math.min(MAX_TILES, Math.max(1, Math.ceil(width / tileW)));
  const times = useMemo(() => {
    const out: Micros[] = [];
    for (let i = 0; i < count; i++) {
      const timelineOffset = ((i * tileW) / pps) * 1_000_000;
      // De trás para frente, as miniaturas também vêm do fim para o começo.
      out.push(thumbTime(reverse ? Math.max(sourceIn, sourceOut - timelineOffset * speed) : sourceIn + timelineOffset * speed));
    }
    return out;
  }, [count, tileW, pps, sourceIn, sourceOut, speed, reverse]);
  const [uris, setUris] = useState<Record<number, string>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const t of times) {
        if (cancelled) return;
        if (uris[t]) continue;
        const uri = await thumbnail(projectId, asset, t);
        if (uri && !cancelled) setUris((prev) => (prev[t] ? prev : { ...prev, [t]: uri }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // `uris` muda conforme chegam; só os instantes importam.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [times, projectId, asset]);

  return (
    <View style={[StyleSheet.absoluteFill, styles.row]} pointerEvents="none">
      {times.map((t, i) => {
        const uri = uris[t];
        return (
          <View key={i} style={{ width: tileW, height, backgroundColor: colors.surfaceRaised }}>
            {uri ? <Image source={{ uri }} style={{ width: tileW, height }} resizeMode="cover" /> : null}
          </View>
        );
      })}
    </View>
  );
});

/** Forma de onda de um trecho de áudio. */
export const Waveform = memo(function Waveform({
  projectId,
  asset,
  sourceIn,
  sourceOut,
  width,
  height,
  color,
}: {
  projectId: string;
  asset: MediaAsset;
  sourceIn: Micros;
  sourceOut: Micros;
  width: number;
  height: number;
  color: string;
}) {
  const [peaks, setPeaks] = useState<number[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    waveform(projectId, asset).then((p) => {
      if (!cancelled) setPeaks(p);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, asset]);

  const path = useMemo(() => {
    if (!peaks || width <= 0) return null;
    const a = Math.floor((sourceIn / 1_000_000) * PEAKS_PER_SECOND);
    const b = Math.max(a + 1, Math.ceil((sourceOut / 1_000_000) * PEAKS_PER_SECOND));
    const slice = peaks.slice(a, b);
    const bars = Math.max(1, Math.floor(width / 3));
    const builder = Skia.PathBuilder.Make();
    const mid = height / 2;
    for (let i = 0; i < bars; i++) {
      const v = slice[Math.floor((i / bars) * slice.length)] ?? 0;
      const h = Math.max(1, v * (height - 4));
      builder.addRect(Skia.XYWHRect(i * 3, mid - h / 2, 2, h));
    }
    return builder.detach();
  }, [peaks, sourceIn, sourceOut, width, height]);

  if (!path) return null;
  return (
    <Canvas style={[StyleSheet.absoluteFill, { width, height }]} pointerEvents="none">
      <Path path={path} color={color} opacity={0.9} />
    </Canvas>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', overflow: 'hidden' },
});
