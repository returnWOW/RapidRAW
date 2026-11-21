import { Adjustments, MaskContainer } from './adjustments';

/**
 * Human readable names for every adjustment that can appear in the edit
 * history. Keys that are missing fall back to a camelCase split.
 */
const KEY_NAMES: Record<string, string> = {
  activeTools: 'Tool Visibility',
  aiDenoiseAmount: 'AI Denoise Amount',
  aiDenoiseDetail: 'AI Denoise Detail',
  aiDenoiseEnabled: 'AI Denoise',
  aiDenoiseMethod: 'AI Denoise Method',
  aiPatches: 'AI Patches',
  aspectRatio: 'Aspect Ratio',
  baselineExposure: 'Baseline Exposure',
  blacks: 'Blacks',
  brightness: 'Brightness',
  centré: 'Centre',
  centréX: 'Centre X',
  centréY: 'Centre Y',
  chromaticAberrationBlueYellow: 'Chromatic Aberration Blue/Yellow',
  chromaticAberrationRedCyan: 'Chromatic Aberration Red/Cyan',
  clarity: 'Clarity',
  colorCalibration: 'Color Calibration',
  colorGrading: 'Color Grading',
  colorNoiseReduction: 'Color Noise Reduction',
  contrast: 'Contrast',
  crop: 'Crop',
  curveMode: 'Curve Mode',
  curves: 'Curves',
  dehaze: 'Dehaze',
  exposure: 'Exposure',
  flareAmount: 'Flare Amount',
  flipHorizontal: 'Flip Horizontal',
  flipVertical: 'Flip Vertical',
  fogAmount: 'Fog Amount',
  fogDensity: 'Fog Density',
  fogEnabled: 'Fog',
  fogGlow: 'Fog Glow',
  fogHeight: 'Fog Height',
  fogStart: 'Fog Start',
  fogTemperature: 'Fog Temperature',
  fogTint: 'Fog Tint',
  fogVariation: 'Fog Variation',
  glowAmount: 'Glow Amount',
  grainAmount: 'Grain Amount',
  grainRoughness: 'Grain Roughness',
  grainSize: 'Grain Size',
  guidedPerspective: 'Guided Perspective',
  halationAmount: 'Halation Amount',
  highlights: 'Highlights',
  hsl: 'HSL',
  hue: 'Hue',
  lensBlurAmount: 'Lens Blur Amount',
  lensBlurDiffusion: 'Lens Blur Diffusion',
  lensBlurEnabled: 'Lens Blur',
  lensBlurMaxDepth: 'Lens Blur Max Depth',
  lensBlurMaxFade: 'Lens Blur Max Fade',
  lensBlurMinDepth: 'Lens Blur Min Depth',
  lensBlurMinFade: 'Lens Blur Min Fade',
  lensBlurShape: 'Lens Blur Shape',
  lensCorrectionMode: 'Lens Correction Mode',
  lensDistortionAmount: 'Lens Distortion',
  lensDistortionEnabled: 'Lens Distortion',
  lensMaker: 'Lens Maker',
  lensModel: 'Lens Model',
  lensTcaAmount: 'Lens TCA',
  lensTcaEnabled: 'Lens TCA',
  lensVignetteAmount: 'Lens Vignette',
  lensVignetteEnabled: 'Lens Vignette',
  lumaNoiseReduction: 'Luma Noise Reduction',
  lutData: 'LUT Data',
  lutIntensity: 'LUT Intensity',
  lutIsSceneReferred: 'LUT Type',
  lutName: 'LUT',
  lutPath: 'LUT',
  lutSize: 'LUT Size',
  masks: 'Masks',
  monochromeEnabled: 'Black & White',
  monochromeFilm: 'B&W Film',
  monochromeFilterHue: 'B&W Filter Hue',
  monochromeFilterStrength: 'B&W Filter Strength',
  monochromeMix: 'B&W Mix',
  monochromeToning: 'Toning',
  motionBlurAmount: 'Motion Blur Amount',
  motionBlurAngle: 'Motion Blur Angle',
  motionBlurDepth: 'Motion Blur Depth',
  motionBlurDepthEnabled: 'Motion Blur Depth',
  motionBlurHighlights: 'Motion Blur Highlights',
  motionBlurLayer: 'Motion Blur Layer',
  motionBlurType: 'Motion Blur Type',
  negativeBlueWeight: 'Negative Blue Weight',
  negativeContrast: 'Negative Contrast',
  negativeConversionEnabled: 'Negative Conversion',
  negativeExposure: 'Negative Exposure',
  negativeGreenWeight: 'Negative Green Weight',
  negativeRedWeight: 'Negative Red Weight',
  orientationSteps: 'Rotation',
  parametricCurve: 'Parametric Curve',
  pointCurves: 'Point Curves',
  relightAmbient: 'Relight Ambient',
  relightEnabled: 'Relight',
  relightShadowSoftness: 'Relight Shadow Softness',
  relightShadows: 'Relight Shadows',
  relightShine: 'Relight Shine',
  relightSoftness: 'Relight Softness',
  rotation: 'Straighten',
  saturation: 'Saturation',
  shadows: 'Shadows',
  sharpness: 'Sharpness',
  sharpnessThreshold: 'Sharpness Threshold',
  showClipping: 'Show Clipping',
  structure: 'Structure',
  temperature: 'Temperature',
  tint: 'Tint',
  toneMapper: 'Tone Mapper',
  transformAspect: 'Transform Aspect',
  transformDistortion: 'Transform Distortion',
  transformHorizontal: 'Transform Horizontal',
  transformRotate: 'Transform Rotate',
  transformScale: 'Transform Scale',
  transformVertical: 'Transform Vertical',
  transformXOffset: 'Transform X Offset',
  transformYOffset: 'Transform Y Offset',
  vibrance: 'Vibrance',
  vignetteAmount: 'Vignette Amount',
  vignetteCenterX: 'Vignette Center',
  vignetteCenterY: 'Vignette Center',
  vignetteFeather: 'Vignette Feather',
  vignetteMidpoint: 'Vignette Midpoint',
  vignetteRoundness: 'Vignette Roundness',
  whiteBalance: 'White Balance',
  whites: 'Whites',
};

/**
 * These adjustment keys only describe editor state (which tool is open,
 * whether the clipping overlay is on, ...). Changing them is not an edit
 * of the photo, so they never create a history step on their own.
 */
const UI_ONLY_KEYS = new Set(['activeTools', 'showClipping', 'sectionVisibility']);

/**
 * Keys whose string value is meaningful enough to show in a step label
 * (paths and names are excluded so labels stay short).
 */
const STRING_VALUE_KEYS = new Set([
  'curveMode',
  'lensBlurShape',
  'lensCorrectionMode',
  'lensMaker',
  'lensModel',
  'monochromeFilm',
  'monochromeToning',
  'motionBlurLayer',
  'motionBlurType',
  'toneMapper',
]);

/** Number of steps kept per image. Older steps are dropped from the front. */
export const MAX_HISTORY_STEPS = 50;

const MAX_CHANGES = 6;

const CROP_RATIOS = [
  [1, 1],
  [4, 3],
  [3, 4],
  [3, 2],
  [2, 3],
  [5, 4],
  [4, 5],
  [16, 9],
  [9, 16],
  [2, 1],
];

const formatKey = (key: string) =>
  KEY_NAMES[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase());

const formatNumber = (value: number) => {
  const rounded = Number(value.toFixed(2));
  return `${rounded > 0 ? '+' : ''}${rounded}`;
};

const shorten = (value: string, max = 40) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

const formatValue = (value: unknown, key?: string) => {
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (typeof value === 'string') {
    if (!key || !STRING_VALUE_KEYS.has(key)) return null;
    if (!value) return 'Off';
    return shorten(value, 32);
  }
  return null;
};

const withValue = (name: string, value: unknown, key?: string) => {
  const formatted = formatValue(value, key);
  return formatted === null ? name : `${name} ${formatted}`;
};

const definedKeys = (value: object) =>
  Array.isArray(value)
    ? Object.keys(value)
    : Object.keys(value).filter((key) => (value as Record<string, unknown>)[key] !== undefined);

export const isSameValue = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = definedKeys(a);
  const bKeys = definedKeys(b);
  return (
    aKeys.length === bKeys.length &&
    aKeys.every((key) => isSameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
  );
};

/**
 * Returns the adjustment keys that really changed between two states.
 * Editor-only state is ignored so toggling a panel does not pollute the
 * history list.
 */
export const getChangedAdjustmentKeys = (before: Adjustments, after: Adjustments): string[] =>
  Object.keys(after).filter((key) => !UI_ONLY_KEYS.has(key) && !isSameValue(before[key], after[key]));

export const hasMeaningfulHistoryChange = (before: Adjustments, after: Adjustments): boolean =>
  getChangedAdjustmentKeys(before, after).length > 0;

/**
 * True when two adjustment states are the same as far as the photo is
 * concerned. Editor-only keys (open tools, clipping overlay) are ignored,
 * so a timeline can be restored even if those changed in the meantime.
 */
export const areHistoryStatesEqual = (a: Adjustments, b: Adjustments): boolean =>
  !hasMeaningfulHistoryChange(a, b) && !hasMeaningfulHistoryChange(b, a);

/**
 * Keeps the editor's current tool visibility when a persisted snapshot is
 * restored, so reopening an image does not hide panels the user opened.
 */
export const mergeHistoryUiState = (snapshot: Adjustments, current: Adjustments): Adjustments => {
  const merged = { ...snapshot };
  UI_ONLY_KEYS.forEach((key) => {
    if (key in current) merged[key] = current[key];
  });
  return merged;
};

const nestedChanges = (
  prefix: string,
  before: object | null | undefined,
  after: object | null | undefined,
): string[] => {
  if (!after || typeof after !== 'object') return [];
  const prev = (before || {}) as Record<string, unknown>;
  const next = after as Record<string, unknown>;

  return Object.keys(next).flatMap((key): string[] => {
    const previousValue = prev[key];
    const nextValue = next[key];
    if (isSameValue(previousValue, nextValue)) return [];
    if (nextValue && typeof nextValue === 'object' && !Array.isArray(nextValue)) {
      return nestedChanges(`${prefix}: ${formatKey(key)}`, previousValue as object | null, nextValue as object);
    }
    return [withValue(`${prefix}: ${formatKey(key)}`, nextValue, key)];
  });
};

const maskChanges = (before: MaskContainer[] = [], after: MaskContainer[] = []): string[] => {
  const changes: string[] = [];
  before
    .filter((mask) => !after.some((m) => m.id === mask.id))
    .forEach((mask) => changes.push(`Deleted Mask: ${mask.name || 'Mask'}`));

  after.forEach((mask) => {
    const prev = before.find((m) => m.id === mask.id);
    const name = mask.name || 'Mask';
    if (!prev) {
      changes.push(`Added Mask: ${name}`);
      return;
    }
    if (isSameValue(prev, mask)) return;

    changes.push(...nestedChanges(name, prev.adjustments, mask.adjustments));
    if (!isSameValue(prev.subMasks, mask.subMasks)) changes.push(`${name}: Mask Area / Brush`);
    if (prev.opacity !== mask.opacity) changes.push(`${name}: Opacity ${formatNumber(mask.opacity)}`);
    if (prev.invert !== mask.invert) changes.push(`${name}: Invert ${formatValue(mask.invert)}`);
    if (prev.visible !== mask.visible) changes.push(`${name}: Visible ${formatValue(mask.visible)}`);
    if (prev.name !== mask.name) changes.push(`Renamed Mask: ${name}`);
  });
  return changes;
};

const aiPatchChanges = (before: Adjustments['aiPatches'] = [], after: Adjustments['aiPatches'] = []): string[] => {
  if (after.length > before.length) return ['Added AI Patch'];
  if (after.length < before.length) return ['Deleted AI Patch'];
  const changes: string[] = [];
  after.forEach((patch) => {
    const prev = before.find((p) => p.id === patch.id);
    if (!prev) return;
    if (prev.visible !== patch.visible) changes.push('AI Patch Visibility');
    if (!isSameValue(prev.subMasks, patch.subMasks)) changes.push('AI Patch Area');
    if (prev.name !== patch.name) changes.push(`Renamed AI Patch: ${patch.name || 'AI Patch'}`);
    if (prev.prompt !== patch.prompt && patch.prompt) changes.push(`AI Prompt: ${shorten(patch.prompt)}`);
    if (prev.patchData !== patch.patchData) changes.push('AI Generation');
  });
  return changes;
};

const cropLabel = ({ crop, aspectRatio }: Adjustments) => {
  if (!crop) return 'Crop Cleared';
  const ratio = aspectRatio || crop.width / crop.height;
  const standard = CROP_RATIOS.find(([w, h]) => Math.abs(ratio - w / h) < 0.001);
  return `Crop ${standard ? standard.join(':') : `${Math.round(crop.width)} × ${Math.round(crop.height)}`}`;
};

const rotationLabel = (before: Adjustments, after: Adjustments) => {
  const degrees = ((((after.orientationSteps || 0) - (before.orientationSteps || 0)) % 4) + 4) % 4;
  if (degrees === 0) return 'Rotation';
  return `Rotate ${degrees * 90}°`;
};

const lutLabel = (before: Adjustments, after: Adjustments) => {
  if (!after.lutPath) return 'LUT Removed';
  const name = after.lutName || after.lutPath.split(/[\\/]/).pop() || 'LUT';
  return `LUT: ${name}`;
};

/**
 * Turns a pair of adjustment states into a compact, human readable list
 * of the concrete items that changed, e.g. "Exposure +1.2, Contrast +10".
 */
export function getHistoryChanges(
  before: Adjustments,
  after: Adjustments,
  changedKeys: string[] = getChangedAdjustmentKeys(before, after),
): string[] {
  const lutSelectionChanged = changedKeys.some((key) => ['lutPath', 'lutName', 'lutData'].includes(key));

  const changes = changedKeys.flatMap((key): string[] => {
    switch (key) {
      case 'activeTools':
      case 'showClipping':
      case 'sectionVisibility':
        return [];
      case 'masks':
        return maskChanges(before.masks, after.masks);
      case 'aiPatches':
        return aiPatchChanges(before.aiPatches, after.aiPatches);
      case 'crop':
      case 'aspectRatio':
        return key === 'aspectRatio' && changedKeys.includes('crop') ? [] : [cropLabel(after)];
      case 'orientationSteps':
        return [rotationLabel(before, after)];
      case 'rotation':
        return [`Straighten ${formatNumber(after.rotation || 0)}°`];
      case 'lutPath':
      case 'lutName':
        return lutSelectionChanged ? [lutLabel(before, after)] : [];
      case 'lutSize':
        return lutSelectionChanged ? [] : [withValue('LUT Size', after.lutSize, 'lutSize')];
      case 'lutIntensity':
        return lutSelectionChanged ? [] : [withValue('LUT Intensity', after.lutIntensity, 'lutIntensity')];
      case 'lutIsSceneReferred':
      case 'lutData':
        return [];
      case 'curves':
      case 'pointCurves':
      case 'parametricCurve': {
        const curves: Record<string, unknown> = after[key] || {};
        return Object.keys(curves)
          .filter((channel) => !isSameValue(before[key]?.[channel], curves[channel]))
          .map((channel) => `${formatKey(key)}: ${formatKey(channel)}`);
      }
      case 'hsl':
        return Object.keys(after.hsl).flatMap((channel) =>
          nestedChanges(`HSL ${formatKey(channel.replace(/s$/, ''))}`, before.hsl?.[channel], after.hsl[channel]),
        );
      case 'colorGrading':
      case 'colorCalibration':
      case 'whiteBalance':
        return nestedChanges(formatKey(key), before[key], after[key]);
      default:
        return [withValue(formatKey(key), after[key], key)];
    }
  });

  const unique = Array.from(new Set(changes)).filter(Boolean);
  return unique;
}

/** Primary label for a history step (the same text used by the toolbar menu). */
export function describeHistoryChange(before: Adjustments, after: Adjustments, changedKeys?: string[]): string {
  const keys = changedKeys ?? getChangedAdjustmentKeys(before, after);
  const changes = getHistoryChanges(before, after, keys);
  if (changes.length === 0) return keys.length > 0 ? formatKey(keys[0]) : 'Adjustment';
  const extra = changes.length - MAX_CHANGES;
  return changes.slice(0, MAX_CHANGES).join(', ') + (extra > 0 ? ` (+${extra} more)` : '');
}
