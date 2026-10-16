import { createProject } from '../defaults';
import { sec } from '../time';
import type { MediaAsset, Project } from '../types';

let n = 0;

export function videoAsset(seconds: number, opts: Partial<MediaAsset> = {}): MediaAsset {
  n++;
  return {
    id: `v${n}`,
    kind: 'video',
    file: `media/v${n}.mp4`,
    duration: sec(seconds),
    width: 1920,
    height: 1080,
    rotation: 0,
    hasAudio: true,
    originalName: `video${n}.mp4`,
    ...opts,
  };
}

export function imageAsset(opts: Partial<MediaAsset> = {}): MediaAsset {
  n++;
  return {
    id: `i${n}`,
    kind: 'image',
    file: `media/i${n}.jpg`,
    duration: 0,
    width: 1080,
    height: 1350,
    rotation: 0,
    hasAudio: false,
    originalName: `foto${n}.jpg`,
    ...opts,
  };
}

export function audioAsset(seconds: number, opts: Partial<MediaAsset> = {}): MediaAsset {
  n++;
  return {
    id: `m${n}`,
    kind: 'audio',
    file: `media/m${n}.m4a`,
    duration: sec(seconds),
    width: 0,
    height: 0,
    rotation: 0,
    hasAudio: true,
    originalName: `musica${n}.m4a`,
    ...opts,
  };
}

/** Projeto com vídeos das durações pedidas (em segundos), na ordem. */
export function projectWith(...seconds: number[]): Project {
  return createProject({ id: 'p1', name: 'Teste', now: 0, assets: seconds.map((s) => videoAsset(s)) });
}

export const resolve = (relative: string) => `/data/p1/${relative}`;
