/**
 * EdgeTAM (Meta, Apache-2.0) no ONNX Runtime: as quatro redes e o rastreio.
 *
 * Não importa o runtime: recebe as sessões e a classe Tensor de quem chamar
 * (onnxruntime-react-native no app, onnxruntime-node nos testes de paridade).
 * A lógica de memória e escolha fica em core/cutout.ts.
 */
import type { InferenceSession, Tensor as OrtTensor } from 'onnxruntime-react-native';

import {
  MASK_PIXELS,
  MASK_SIZE,
  MEMORY_DIM,
  MEMORY_TOKENS,
  MODEL_SIZE,
  MemoryBank,
  POINTER_DIM,
  chooseMask,
  maskOf,
  pointerOf,
  type DecoderOutput,
  type MemoryEntry,
  type Prompt,
} from '@/core/cutout';

export interface EdgeTamSessions {
  imageEncoder: InferenceSession;
  maskDecoder: InferenceSession;
  memoryEncoder: InferenceSession;
  memoryAttention: InferenceSession;
}

type TensorClass = typeof OrtTensor;

/** Saídas do codificador de imagem de um quadro (ficam no runtime, não são lidas em JS). */
export interface Features {
  f0: OrtTensor;
  f1: OrtTensor;
  f2: OrtTensor;
}

/** Sem toques: um ponto "vazio" (rótulo −1), como o SAM 2 faz no rastreio. */
const NO_PROMPT = { points: new Float32Array([0, 0]), labels: new Int32Array([-1]) };
const NO_MASK = new Float32Array(MASK_PIXELS);

export interface Segmentation {
  /** Logits 256x256 da máscara escolhida. */
  logits: Float32Array;
  pointer: Float32Array;
  objectScore: number;
}

export class EdgeTam {
  readonly bank = new MemoryBank();

  constructor(
    private readonly sessions: EdgeTamSessions,
    private readonly Tensor: TensorClass,
  ) {}

  /** Quadro RGBA já esticado para 1024x1024. */
  async encode(rgba: Uint8Array): Promise<Features> {
    if (rgba.length !== MODEL_SIZE * MODEL_SIZE * 4) throw new Error('Quadro com tamanho errado.');
    const out = await this.sessions.imageEncoder.run({ image: new this.Tensor('uint8', rgba, [MODEL_SIZE, MODEL_SIZE, 4]) });
    return { f0: out.f0!, f1: out.f1!, f2: out.f2! };
  }

  async decode(
    feats: Features,
    f2: OrtTensor,
    prompt: Pick<Prompt, 'points' | 'labels'>,
    cond: boolean,
    maskInput: Float32Array | null = null,
  ): Promise<DecoderOutput> {
    const n = prompt.labels.length;
    const T = this.Tensor;
    const out = await this.sessions.maskDecoder.run({
      f0: feats.f0,
      f1: feats.f1,
      f2,
      points: new T('float32', prompt.points, [1, n, 2]),
      labels: new T('int32', prompt.labels, [1, n]),
      mask_input: new T('float32', maskInput ?? NO_MASK, [1, 1, MASK_SIZE, MASK_SIZE]),
      has_mask: new T('float32', new Float32Array([maskInput ? 1 : 0]), [1]),
      cond: new T('float32', new Float32Array([cond ? 1 : 0]), [1]),
    });
    return {
      masks: out.masks!.data as Float32Array,
      iou: out.iou!.data as Float32Array,
      pointers: out.pointers!.data as Float32Array,
      objectScore: (out.object_score!.data as Float32Array)[0]!,
    };
  }

  /** Memória de um quadro a partir da máscara escolhida (logits 256x256). */
  async remember(feats: Features, logits: Float32Array, fromPrompt: boolean): Promise<Pick<MemoryEntry, 'memory' | 'memoryPos'>> {
    const T = this.Tensor;
    const out = await this.sessions.memoryEncoder.run({
      f2: feats.f2,
      mask: new T('float32', logits, [1, 1, MASK_SIZE, MASK_SIZE]),
      from_points: new T('float32', new Float32Array([fromPrompt ? 1 : 0]), [1]),
    });
    return { memory: out.memory!.data as Float32Array, memoryPos: out.memory_pos!.data as Float32Array };
  }

  /**
   * Quadro do laço: máscara a partir da caixa e dos toques. `previous` são os
   * logits da tentativa anterior no mesmo quadro (refina em vez de recomeçar).
   */
  async segment(feats: Features, prompt: Prompt, previous: Float32Array | null = null): Promise<Segmentation> {
    const out = await this.decode(feats, feats.f2, prompt, true, previous);
    const k = chooseMask(out, prompt.multimask);
    return { logits: maskOf(out, k), pointer: pointerOf(out, k), objectScore: out.objectScore };
  }

  /** Fixa o quadro do laço como referência do rastreio, com a máscara final (já com o laço aplicado). */
  async setPrompt(frame: number, feats: Features, seg: Segmentation): Promise<void> {
    const mem = await this.remember(feats, seg.logits, true);
    this.bank.setPrompt(frame, { ...mem, pointer: seg.pointer });
  }

  /** Um passo do rastreio: o quadro `frame` com as memórias dos vizinhos já rastreados. */
  async track(frame: number, feats: Features, direction: 1 | -1, totalFrames: number): Promise<Segmentation> {
    const a = this.bank.inputs(frame, direction, totalFrames);
    const T = this.Tensor;
    const cond = await this.sessions.memoryAttention.run({
      f2: feats.f2,
      memory: new T('float32', a.memory, [a.frames, MEMORY_TOKENS, MEMORY_DIM]),
      memory_pos: new T('float32', a.memoryPos, [a.frames, MEMORY_TOKENS, MEMORY_DIM]),
      slots: new T('int32', a.slots, [a.frames]),
      pointers: new T('float32', a.pointers, [a.numPointers, POINTER_DIM]),
    });
    const out = await this.decode(feats, cond.f2_conditioned!, NO_PROMPT, false);
    const k = chooseMask(out, true);
    const seg = { logits: maskOf(out, k), pointer: pointerOf(out, k), objectScore: out.objectScore };
    const mem = await this.remember(feats, seg.logits, false);
    this.bank.add(frame, { ...mem, pointer: seg.pointer });
    return seg;
  }
}
