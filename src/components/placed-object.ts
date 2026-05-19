import type { Object3D } from 'three';

export interface PlacedObjectData {
  modelKey: string;
  category: 'floor' | 'wall' | 'prop';
  gridX: number;
  gridZ: number;
  rotY: number;
}

export function getPlacedObject(obj: Object3D): PlacedObjectData | undefined {
  return obj.userData.__placedObject as PlacedObjectData | undefined;
}

export function setPlacedObject(obj: Object3D, data: PlacedObjectData): void {
  obj.userData.__placedObject = data;
}
