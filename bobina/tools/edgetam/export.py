"""
Exporta o EdgeTAM (Meta, Apache-2.0) para ONNX nos quatro grafos que o app usa
no recorte com laço. O banco de memória (quais quadros entram na atenção) fica
no app, em TypeScript: aqui só há redes, sem estado.

    image_encoder     quadro RGBA 1024x1024 (uint8)  -> f0, f1, f2
    mask_decoder      f0, f1, f2 + pontos/caixa/máscara -> 4 máscaras, 4 notas, 4 ponteiros, presença
    memory_encoder    f2 + máscara (logits 256x256)  -> memória do quadro (512 tokens)
    memory_attention  f2 + memórias + ponteiros      -> f2 condicionado (para o mask_decoder)

Uso: python export.py --out DIR [--check]
"""
import argparse
import hashlib
import json
import os

import numpy as np
import torch
import torch.nn.functional as F
from torch import nn

REPO = 'yonigozlan/EdgeTAM-hf'
REVISION = 'c266ce53b3fc00f0f495b583f6a116c4e57f53bb'
OPSET = 17
NO_OBJ_SCORE = -1024.0


def rotate_pairwise(x):
    x = x.reshape(*x.shape[:-1], -1, 2)
    x1, x2 = x.unbind(dim=-1)
    return torch.stack((-x2, x1), dim=-1).flatten(start_dim=-2)


def rope(x, cos, sin):
    return x * cos + rotate_pairwise(x) * sin


def attend(q, k, v, scale):
    w = torch.softmax(torch.matmul(q, k.transpose(-1, -2)) * scale, dim=-1)
    return torch.matmul(w, v)


class ImageEncoder(nn.Module):
    """RGBA uint8 [1024,1024,4] (o quadro já redimensionado, como o Skia lê) -> f0, f1, f2."""

    def __init__(self, model):
        super().__init__()
        self.model = model
        self.register_buffer('mean', torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1) * 255.0)
        self.register_buffer('std', torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1) * 255.0)

    def forward(self, rgba):
        x = rgba[:, :, :3].permute(2, 0, 1).unsqueeze(0).float()
        x = (x - self.mean) / self.std
        out = self.model.get_image_features(x, return_dict=True)
        f = out.fpn_hidden_states
        f0 = f[0].permute(1, 2, 0).reshape(1, 32, 256, 256)
        f1 = f[1].permute(1, 2, 0).reshape(1, 64, 128, 128)
        f2 = f[2].permute(1, 2, 0).reshape(1, 256, 64, 64)
        return f0, f1, f2


class MaskDecoder(nn.Module):
    """
    Devolve as quatro saídas (token 0 = máscara única; 1..3 = alternativas) para o
    app escolher como o SAM 2: uma só com caixa/vários pontos, a melhor das três
    com um clique ou no rastreio. `cond` = 1 no quadro com o laço (sem memória).
    """

    def __init__(self, model):
        super().__init__()
        self.model = model
        with torch.no_grad():
            self.register_buffer('image_pe', model.get_image_wide_positional_embeddings().clone())

    def forward(self, f0, f1, f2, points, labels, mask_input, has_mask, cond):
        m = self.model
        dec = m.mask_decoder
        pix = f2 + cond.view(1, 1, 1, 1) * m.no_memory_embedding.view(1, 256, 1, 1)
        sparse, _ = m.prompt_encoder(input_points=points.unsqueeze(1), input_labels=labels.unsqueeze(1), input_boxes=None, input_masks=None)
        h = has_mask.view(1, 1, 1, 1)
        dense = h * m.prompt_encoder.mask_embed(mask_input) + (1 - h) * m.prompt_encoder.no_mask_embed.weight.reshape(1, -1, 1, 1)
        tokens = torch.cat([dec.obj_score_token.weight, dec.iou_token.weight, dec.mask_tokens.weight], dim=0)
        tokens = torch.cat([tokens.unsqueeze(0).unsqueeze(0), sparse], dim=2)
        image = pix + dense
        point_out, image_out = dec.transformer(
            point_embeddings=tokens, image_embeddings=image, image_positional_embeddings=self.image_pe, attention_similarity=None
        )
        iou_token = point_out[:, :, 1, :]
        mask_tokens = point_out[:, :, 2:6, :]
        image_out = image_out.transpose(2, 3).reshape(1, 256, 64, 64)
        up = dec.upscale_conv1(image_out) + f1
        up = dec.activation(dec.upscale_layer_norm(up))
        up = dec.activation(dec.upscale_conv2(up) + f0)
        hyper = torch.stack([dec.output_hypernetworks_mlps[i](mask_tokens[:, :, i, :]) for i in range(4)], dim=2)
        masks = torch.matmul(hyper, up.reshape(1, 1, 32, 256 * 256)).reshape(1, 4, 256, 256)
        iou = dec.iou_prediction_head(iou_token).reshape(1, 4)
        obj = dec.pred_obj_score_head(point_out[:, :, 0, :]).reshape(1, 1)
        present = (obj > 0).float()
        masks = torch.where(present.view(1, 1, 1, 1) > 0, masks, torch.full_like(masks, NO_OBJ_SCORE))
        ptr = m.object_pointer_proj(mask_tokens).reshape(1, 4, 256)
        ptr = present.view(1, 1, 1) * ptr + (1 - present.view(1, 1, 1)) * m.no_object_pointer.view(1, 1, 256)
        return masks, iou, ptr, obj


class MemoryEncoder(nn.Module):
    """f2 (sem memória) + logits 256x256 da máscara escolhida -> 512 tokens de memória e posições."""

    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, f2, mask, from_points):
        high = F.interpolate(mask, size=(1024, 1024), mode='bilinear', align_corners=False)
        fp = from_points.view(1, 1, 1, 1)
        prob = fp * (high > 0).float() + (1 - fp) * torch.sigmoid(high)
        prob = prob * self.model.config.sigmoid_scale_for_mem_enc + self.model.config.sigmoid_bias_for_mem_enc
        feats, pos = self.model.memory_encoder(f2, prob)
        feats, pos = self.model.spatial_perceiver(feats, pos)
        return feats.reshape(1, 512, 64), pos.reshape(1, 512, 64)


class MemoryAttention(nn.Module):
    """
    f2 do quadro + memórias [F,512,64] (com a posição espacial de cada uma), o
    "lugar" de cada memória no tempo (0..6) e os ponteiros [P,256] -> f2 condicionado.
    Cada memória tem 256 tokens globais e 256 numa grade 16x16 (só esses levam RoPE).
    """

    def __init__(self, model, pos2):
        super().__init__()
        ma = model.memory_attention
        self.ma = ma
        self.register_buffer('pos2', pos2.clone())
        self.register_buffer('tpos', model.memory_temporal_positional_encoding.detach().reshape(-1, 64).clone())
        with torch.no_grad():
            dummy = torch.zeros(1)
            cos, sin = ma.rotary_emb(dummy, ma.position_ids)
            cos_k, sin_k = ma.rotary_emb(dummy, ma.position_ids_k)
        self.register_buffer('cos', cos.reshape(1, 4096, 256).clone())
        self.register_buffer('sin', sin.reshape(1, 4096, 256).clone())
        self.register_buffer('cos_k', cos_k.reshape(1, 1, 256, 256).clone())
        self.register_buffer('sin_k', sin_k.reshape(1, 1, 256, 256).clone())
        self.scale = 256 ** -0.5

    def forward(self, f2, memory, memory_pos, slots, pointers):
        x = f2.flatten(2).transpose(1, 2) + 0.1 * self.pos2
        mem_pos = memory_pos + self.tpos[slots.long()].unsqueeze(1)
        ptr = pointers.reshape(1, -1, 64)
        for layer in self.ma.layers:
            sa = layer.self_attn
            q = layer.layer_norm1(x)
            qq = rope(sa.q_proj(q), self.cos, self.sin)
            kk = rope(sa.k_proj(q), self.cos, self.sin)
            x = x + sa.o_proj(attend(qq, kk, sa.v_proj(q), self.scale))
            ca = layer.cross_attn_image
            q = rope(ca.q_proj(layer.layer_norm2(x)), self.cos, self.sin)
            k_mem = ca.k_proj(memory + mem_pos).unsqueeze(0)
            k_mem = torch.cat([k_mem[:, :, :256], rope(k_mem[:, :, 256:], self.cos_k, self.sin_k)], dim=2).reshape(1, -1, 256)
            k = torch.cat([k_mem, ca.k_proj(ptr)], dim=1)
            v = torch.cat([ca.v_proj(memory).reshape(1, -1, 256), ca.v_proj(ptr)], dim=1)
            x = x + ca.o_proj(attend(q, k, v, self.scale))
            x = x + layer.mlp(layer.layer_norm3(x))
        x = self.ma.layer_norm(x)
        return x.transpose(1, 2).reshape(1, 256, 64, 64)


def load_model():
    from transformers import EdgeTamVideoModel

    model = EdgeTamVideoModel.from_pretrained(REPO, revision=REVISION, attn_implementation='eager').eval()
    for p in model.parameters():
        p.requires_grad_(False)
    return model


def constant_pos2(model):
    with torch.no_grad():
        out = model.get_image_features(torch.zeros(1, 3, 1024, 1024), return_dict=True)
    return out.fpn_position_encoding[2].permute(1, 0, 2).reshape(1, 4096, 256)


def sample_inputs():
    g = torch.Generator().manual_seed(0)
    rgba = torch.randint(0, 256, (1024, 1024, 4), dtype=torch.uint8, generator=g)
    return rgba


def export(model, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    pos2 = constant_pos2(model)
    enc = ImageEncoder(model).eval()
    dec = MaskDecoder(model).eval()
    menc = MemoryEncoder(model).eval()
    attn = MemoryAttention(model, pos2).eval()
    rgba = sample_inputs()
    with torch.no_grad():
        f0, f1, f2 = enc(rgba)
    pts = torch.tensor([[[100.0, 120.0], [700.0, 800.0], [400.0, 500.0]]])
    lab = torch.tensor([[2, 3, 1]], dtype=torch.int32)
    dec_in = (f0, f1, f2, pts, lab, torch.zeros(1, 1, 256, 256), torch.zeros(1), torch.ones(1))
    menc_in = (f2, torch.randn(1, 1, 256, 256), torch.ones(1))
    mem = torch.randn(3, 512, 64)
    attn_in = (f2, mem, torch.randn(3, 512, 64), torch.tensor([6, 1, 0], dtype=torch.int32), torch.randn(5, 256))
    jobs = [
        ('image_encoder', enc, (rgba,), ['image'], ['f0', 'f1', 'f2'], None),
        ('mask_decoder', dec, dec_in,
         ['f0', 'f1', 'f2', 'points', 'labels', 'mask_input', 'has_mask', 'cond'], ['masks', 'iou', 'pointers', 'object_score'],
         {'points': {1: 'num_points'}, 'labels': {1: 'num_points'}}),
        ('memory_encoder', menc, menc_in, ['f2', 'mask', 'from_points'], ['memory', 'memory_pos'], None),
        ('memory_attention', attn, attn_in, ['f2', 'memory', 'memory_pos', 'slots', 'pointers'], ['f2_conditioned'],
         {'memory': {0: 'frames'}, 'memory_pos': {0: 'frames'}, 'slots': {0: 'frames'}, 'pointers': {0: 'num_pointers'}}),
    ]
    files = {}
    for name, module, args, inames, onames, dyn in jobs:
        path = os.path.join(out_dir, f'{name}.onnx')
        torch.onnx.export(module, args, path, input_names=inames, output_names=onames, dynamic_axes=dyn,
                          opset_version=OPSET, dynamo=False, do_constant_folding=True)
        files[name] = path
        print('exported', name, os.path.getsize(path) // 1024, 'KB', flush=True)
    return files, dict(enc=enc, dec=dec, menc=menc, attn=attn, samples=dict(image_encoder=(rgba,), mask_decoder=dec_in, memory_encoder=menc_in, memory_attention=attn_in))


def check(files, mods):
    import onnxruntime as ort

    worst = {}
    names = {'image_encoder': 'enc', 'mask_decoder': 'dec', 'memory_encoder': 'menc', 'memory_attention': 'attn'}
    for name, path in files.items():
        sess = ort.InferenceSession(path, providers=['CPUExecutionProvider'])
        args = mods['samples'][name]
        feeds = {i.name: a.numpy() for i, a in zip(sess.get_inputs(), args)}
        got = sess.run(None, feeds)
        with torch.no_grad():
            ref = mods[names[name]](*args)
        ref = ref if isinstance(ref, tuple) else (ref,)
        diffs = [float(np.abs(g - r.numpy()).max()) for g, r in zip(got, ref)]
        worst[name] = diffs
        print('check', name, ['%.2e' % d for d in diffs], flush=True)
    return worst


def manifest(out_dir, model):
    entries = []
    for name in ('image_encoder', 'mask_decoder', 'memory_encoder', 'memory_attention'):
        path = os.path.join(out_dir, f'{name}.onnx')
        data = open(path, 'rb').read()
        entries.append(dict(name=name, file=f'{name}.onnx', bytes=len(data), sha256=hashlib.sha256(data).hexdigest()))
    md = model.mask_downsample
    info = dict(
        model='EdgeTAM', source=f'https://huggingface.co/{REPO}', revision=REVISION, license='Apache-2.0',
        image_size=1024, num_maskmem=7, max_object_pointers=16, files=entries,
        # O app reduz a máscara desenhada à mão para 256x256 com esta convolução 4x4 (passo 4).
        mask_downsample=dict(weight=md.weight.detach().reshape(-1).tolist(), bias=float(md.bias.detach()[0])),
    )
    with open(os.path.join(out_dir, 'manifest.json'), 'w') as f:
        json.dump(info, f, indent=1)
    return info


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--check', action='store_true')
    a = ap.parse_args()
    torch.set_num_threads(max(1, (os.cpu_count() or 2) // 2))
    model = load_model()
    files, mods = export(model, a.out)
    if a.check:
        worst = check(files, mods)
        bad = {k: v for k, v in worst.items() if max(v) > 2e-2}
        if bad:
            raise SystemExit(f'ONNX difere do PyTorch: {bad}')
    info = manifest(a.out, model)
    print(json.dumps({e['name']: e['bytes'] for e in info['files']}))


if __name__ == '__main__':
    main()
