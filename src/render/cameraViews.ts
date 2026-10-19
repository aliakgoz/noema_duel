/** All views retain north toward the top and leave controls in world directions. */
export const CAMERA_VIEWS = [
  { label: 'Perspektif', azimuth: 12, elevation: 40 },
  { label: 'Sol çapraz', azimuth: -26, elevation: 48 },
  { label: 'Üstten', azimuth: 18, elevation: 67 },
] as const;

export type CameraView = 0 | 1 | 2;
