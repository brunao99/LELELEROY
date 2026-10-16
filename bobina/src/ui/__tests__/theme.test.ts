/// <reference types="node" />
import { readFileSync } from 'fs';
import { join } from 'path';

import { colors, layout, radius, space } from '../theme';

const tokens = JSON.parse(readFileSync(join(__dirname, '../../../../replica/design/tokens.json'), 'utf8'));

const camel = (s: string) => s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

describe('tema = tokens do design', () => {
  it('cores iguais', () => {
    for (const [name, value] of Object.entries(tokens.color as Record<string, string>)) {
      expect({ name, value: (colors as Record<string, string>)[camel(name)] }).toEqual({ name, value });
    }
  });

  it('espaços, raios e layout iguais', () => {
    expect([...space]).toEqual(tokens.space);
    expect(radius).toEqual(tokens.radius);
    expect(layout).toEqual(tokens.layout);
  });
});
