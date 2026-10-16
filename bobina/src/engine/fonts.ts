import type { DataModule } from '@shopify/react-native-skia';

import type { FontId } from '@/core/types';

export interface FontInfo {
  id: FontId;
  /** Nome da família registrado no Skia. */
  family: string;
  /** Rótulo na lista de fontes. */
  label: string;
  /** Fontes variáveis mudam o peso pelo eixo `wght`; as outras engrossam sintético. */
  variable: boolean;
}

export const FONTS: FontInfo[] = [
  { id: 'inter', family: 'Inter', label: 'Inter', variable: true },
  { id: 'montserrat', family: 'Montserrat', label: 'Montserrat', variable: true },
  { id: 'bebas', family: 'Bebas Neue', label: 'Bebas Neue', variable: false },
  { id: 'oswald', family: 'Oswald', label: 'Oswald', variable: true },
  { id: 'robotoSlab', family: 'Roboto Slab', label: 'Roboto Slab', variable: true },
  { id: 'lobster', family: 'Lobster', label: 'Lobster', variable: false },
  { id: 'pacifico', family: 'Pacifico', label: 'Pacifico', variable: false },
  { id: 'marker', family: 'Permanent Marker', label: 'Marcador', variable: false },
];

export function fontInfo(id: FontId): FontInfo {
  return FONTS.find((f) => f.id === id) ?? FONTS[0]!;
}

/** Arquivos das fontes (licenças OFL e Apache em assets/fonts/licenses). */
export const FONT_SOURCES: Record<string, DataModule[]> = {
  Inter: [require('../../assets/fonts/Inter.ttf')],
  Montserrat: [require('../../assets/fonts/Montserrat.ttf')],
  'Bebas Neue': [require('../../assets/fonts/BebasNeue.ttf')],
  Oswald: [require('../../assets/fonts/Oswald.ttf')],
  'Roboto Slab': [require('../../assets/fonts/RobotoSlab.ttf')],
  Lobster: [require('../../assets/fonts/Lobster.ttf')],
  Pacifico: [require('../../assets/fonts/Pacifico.ttf')],
  'Permanent Marker': [require('../../assets/fonts/PermanentMarker.ttf')],
};
