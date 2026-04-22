import { createComponent, Types } from '@iwsdk/core';

export const PlacedObject = createComponent('PlacedObject', {
  modelKey: { type: Types.String,  default: '' },
  category: { type: Types.String,  default: 'floor' }, // 'floor' | 'wall' | 'prop'
  gridX:    { type: Types.Float32, default: 0 },
  gridZ:    { type: Types.Float32, default: 0 },
  rotY:     { type: Types.Float32, default: 0 },
});
