import {
  TEMPLATES,
  addPhotos,
  applyGesture,
  cellAt,
  clampFraming,
  collageDesignSize,
  countCells,
  createCollage,
  defaultTemplate,
  dividerAt,
  duplicateLayer,
  gridGeometry,
  gridMetrics,
  layerAt,
  layerBox,
  moveLayer,
  photoInCell,
  resizeSplit,
  scatterColumns,
  setFree,
  setSlot,
  setTemplate,
  swapSlots,
  templateById,
  visibleSlots,
  type Collage,
  type CollagePhoto,
  type LayoutNode,
} from '../collage';

let seq = 0;
const newId = () => `id${++seq}`;

function photo(i: number, width = 1200, height = 1600): CollagePhoto {
  return { id: `p${i}`, file: `media/p${i}.jpg`, preview: `media/p${i}-s.jpg`, width, height };
}

function collageWith(n: number): Collage {
  return createCollage({
    id: 'c1',
    name: 'Teste',
    now: 0,
    ratio: '9:16',
    photos: Array.from({ length: n }, (_, i) => photo(i + 1)),
    newId,
  });
}

describe('modelos de grade', () => {
  it('cada modelo tem o número de células do nome', () => {
    for (const t of TEMPLATES) expect(t.cells).toBe(Number(t.id.split('-')[0]));
    for (let n = 1; n <= 9; n++) expect(defaultTemplate(n)?.cells).toBe(n);
  });

  it('as frações de cada divisão somam 1', () => {
    const check = (node: LayoutNode) => {
      if (node.kind === 'cell') return;
      expect(node.sizes.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 9);
      node.children.forEach(check);
    };
    TEMPLATES.forEach((t) => check(t.build()));
  });
});

describe('geometria da grade', () => {
  it('2x2 com espaço e margem', () => {
    const root = templateById('4-grid')!.build();
    const { cells, dividers } = gridGeometry(root, 1000, 1000, 20, 50);
    expect(cells).toHaveLength(4);
    expect(cells[0]).toEqual({ x: 50, y: 50, w: 440, h: 440 });
    expect(cells[3]).toEqual({ x: 510, y: 510, w: 440, h: 440 });
    // Uma linha horizontal (entre as fileiras) e uma vertical em cada fileira.
    expect(dividers).toHaveLength(3);
    const horizontal = dividers.find((d) => d.dir === 'col')!;
    expect(horizontal.cy).toBe(500);
    expect(horizontal.length).toBe(880);
  });

  it('arrastar uma linha muda as duas fatias vizinhas e respeita o mínimo', () => {
    const root = templateById('3-top')!.build();
    // A linha da fileira de baixo (caminho [1], índice 0).
    const moved = resizeSplit(root, [1], 0, 0.1);
    expect(moved).not.toBe(root);
    const bottom = (moved as Extract<LayoutNode, { kind: 'split' }>).children[1] as Extract<LayoutNode, { kind: 'split' }>;
    expect(bottom.sizes[0]).toBeCloseTo(0.6);
    expect(bottom.sizes[1]).toBeCloseTo(0.4);
    // O original não muda.
    expect((root as Extract<LayoutNode, { kind: 'split' }>).children[1]).not.toBe(bottom);
    const clamped = resizeSplit(root, [], 0, 5) as Extract<LayoutNode, { kind: 'split' }>;
    expect(clamped.sizes[1]).toBeCloseTo(0.12);
    expect(resizeSplit(root, [7], 0, 0.1)).toBe(root);
  });

  it('linha e célula sob o dedo', () => {
    const { cells, dividers } = gridGeometry(templateById('2-row')!.build(), 1000, 800, 20, 0);
    expect(cellAt(cells, 100, 100)).toBe(0);
    expect(cellAt(cells, 900, 100)).toBe(1);
    expect(cellAt(cells, 500, 100)).toBe(-1);
    expect(dividerAt(dividers, 505, 400, 30)).toBe(0);
    expect(dividerAt(dividers, 560, 400, 30)).toBe(-1);
  });
});

describe('enquadramento na célula', () => {
  const cell = { x: 0, y: 0, w: 400, h: 400 };

  it('a foto cobre a célula e o deslocamento fica dentro do limite', () => {
    const r = photoInCell(cell, 800, 1200, { zoom: 1, x: 0, y: 0.9, flipH: false });
    expect(r.w).toBe(400);
    expect(r.h).toBe(600);
    // Só pode descer 100 (metade da sobra).
    expect(r.y).toBe(0);
    const f = clampFraming(cell, 800, 1200, { zoom: 1, x: 0.5, y: 0.9, flipH: false });
    expect(f.x).toBe(0);
    expect(f.y).toBeCloseTo(100 / 600);
  });

  it('gesto na célula: arrastar e aproximar', () => {
    const c = collageWith(2);
    const { width: W, height: H } = collageDesignSize(c);
    const moved = applyGesture(c, { kind: 'cell', cell: 0, dx: 0, dy: -40, zoom: 2 }, W, H);
    const f = moved.framing.p1!;
    expect(f.zoom).toBe(2);
    expect(f.y).toBeLessThan(0);
    const m = gridMetrics(c, W, H);
    const cellRect = gridGeometry(c.grid!.root, W, H, m.gap, m.margin).cells[0]!;
    const r = photoInCell(cellRect, 1200, 1600, f);
    expect(r.x).toBeLessThanOrEqual(cellRect.x + 0.001);
    expect(r.x + r.w).toBeGreaterThanOrEqual(cellRect.x + cellRect.w - 0.001);
  });
});

describe('montar a colagem', () => {
  it('até 9 fotos: grade; acima disso: livre', () => {
    const grid = collageWith(4);
    expect(grid.grid?.template).toBe('4-grid');
    expect(visibleSlots(grid)).toEqual(['p1', 'p2', 'p3', 'p4']);
    const free = collageWith(12);
    expect(free.grid).toBeNull();
    expect(free.layers).toHaveLength(12);
    expect(free.layers.every((l) => l.kind === 'photo')).toBe(true);
  });

  it('foto nova ocupa a célula vazia e depois aumenta o modelo', () => {
    let c = setSlot(collageWith(3), 1, null);
    expect(visibleSlots(c)).toEqual(['p1', null, 'p3']);
    c = addPhotos(c, [photo(7)], newId);
    expect(visibleSlots(c)).toEqual(['p1', 'p7', 'p3']);
    c = addPhotos(c, [photo(8), photo(9)], newId);
    expect(c.grid?.template.startsWith('5')).toBe(true);
    expect(visibleSlots(c)).toEqual(['p1', 'p7', 'p3', 'p8', 'p9']);
    c = addPhotos(c, Array.from({ length: 5 }, (_, i) => photo(20 + i)), newId);
    expect(c.grid).toBeNull();
    expect(c.layers.filter((l) => l.kind === 'photo')).toHaveLength(10);
  });

  it('modelo menor guarda as fotos de sobra para quando crescer de novo', () => {
    let c = collageWith(4);
    c = setTemplate(c, '2-col');
    expect(visibleSlots(c)).toEqual(['p1', 'p2']);
    c = setTemplate(c, '4-top');
    expect(visibleSlots(c)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  it('livre e de volta para a grade sem perder fotos, figurinhas ficam', () => {
    let c = collageWith(3);
    c = { ...c, layers: [{ kind: 'text', id: 't1', text: 'Oi', style: {} as never, transform: { x: 0, y: 0, scale: 1, rotation: 0 } }] };
    c = setFree(c, newId);
    expect(c.grid).toBeNull();
    expect(c.layers.map((l) => l.kind)).toEqual(['photo', 'photo', 'photo', 'text']);
    c = setTemplate(c, '3-col');
    expect(visibleSlots(c)).toEqual(['p1', 'p2', 'p3']);
    expect(c.layers.map((l) => l.kind)).toEqual(['text']);
  });

  it('trocar fotos de lugar', () => {
    const c = swapSlots(collageWith(3), 0, 2);
    expect(visibleSlots(c)).toEqual(['p3', 'p2', 'p1']);
  });
});

describe('camadas', () => {
  it('toque acha a camada de cima, inclusive girada', () => {
    let c = collageWith(12);
    const { width: W, height: H } = collageDesignSize(c);
    const top = c.layers[c.layers.length - 1]!;
    const box = layerBox(c, top, W, H, null)!;
    expect(layerAt(c, W, H, box.cx, box.cy, 0, {})).toBe(top.id);
    c = { ...c, layers: c.layers.map((l) => (l.id === top.id ? { ...l, transform: { ...l.transform, rotation: 45 } } : l)) };
    const turned = layerBox(c, c.layers[c.layers.length - 1]!, W, H, null)!;
    // O canto da caixa sem giro fica de fora depois de girar 45°.
    expect(layerAt(c, W, H, turned.cx + turned.w / 2 - 2, turned.cy + turned.h / 2 - 2, 0, {})).not.toBe(top.id);
  });

  it('gesto na camada move, escala e gira', () => {
    const c = collageWith(12);
    const { width: W, height: H } = collageDesignSize(c);
    const id = c.layers[0]!.id;
    const t0 = c.layers[0]!.transform;
    const moved = applyGesture(c, { kind: 'layer', id, dx: W * 0.1, dy: 0, scale: 2, rotation: 15 }, W, H);
    const t = moved.layers[0]!.transform;
    expect(t.x).toBeCloseTo(t0.x + 0.1);
    expect(t.scale).toBeCloseTo(t0.scale * 2);
    expect(t.rotation).toBeCloseTo(t0.rotation + 15);
    expect(moved.layers[1]).toBe(c.layers[1]);
  });

  it('frente, trás e duplicar', () => {
    const c = collageWith(12);
    const first = c.layers[0]!.id;
    expect(moveLayer(c, first, 'front').layers.at(-1)!.id).toBe(first);
    expect(moveLayer(c, first, 'back')).toBe(c);
    const d = duplicateLayer(c, first, 'copy');
    expect(d.layers[1]!.id).toBe('copy');
    expect(d.layers[1]!.transform.x).toBeCloseTo(c.layers[0]!.transform.x + 0.04);
  });
});

describe('contagem de células', () => {
  it('conta folhas', () => {
    expect(countCells(templateById('9-b')!.build())).toBe(9);
  });
});

describe('mural (colagem livre)', () => {
  it('colunas pela proporção das fotos', () => {
    // Fotos em pé (3:4) num story: duas colunas.
    expect(scatterColumns(6, 0.75, 1080, 1920)).toBe(2);
    // Fotos deitadas (16:9) num story: uma coluna.
    expect(scatterColumns(4, 16 / 9, 1080, 1920)).toBe(1);
    // Quadradas num quadro quadrado: 3x3.
    expect(scatterColumns(9, 1, 1080, 1080)).toBe(3);
  });

  it('as fotos ficam dentro do quadro', () => {
    for (const n of [2, 5, 12]) {
      const c = setFree(collageWith(Math.min(n, 9)), newId);
      const { width: W, height: H } = collageDesignSize(c);
      for (const layer of c.layers) {
        const box = layerBox(c, layer, W, H, null)!;
        expect(box.cx - box.w / 2).toBeGreaterThan(-W * 0.02);
        expect(box.cx + box.w / 2).toBeLessThan(W * 1.02);
        expect(box.cy - box.h / 2).toBeGreaterThan(-H * 0.02);
        expect(box.cy + box.h / 2).toBeLessThan(H * 1.02);
      }
    }
  });
});
