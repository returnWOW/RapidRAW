import { RefObject } from 'react';
import { create } from 'zustand';
import debounce from 'lodash.debounce';
import { Adjustments, INITIAL_ADJUSTMENTS, MaskContainer, CropGeometry, pickCropGeometry } from '../utils/adjustments';
import {
  SelectedImage,
  WaveformData,
  BrushSettings,
  ChannelConfig,
  OverlayMode,
  type SpeedEditTarget,
  type ImageDefaults,
} from '../types/editor';
import { CompareView } from '../types/settings';
import { ImageDimensions } from '../hooks/useImageRenderSize';
import { ToolType } from '../types/masks';
import {
  areHistoryStatesEqual,
  describeHistoryChange,
  getChangedAdjustmentKeys,
  mergeHistoryUiState,
  MAX_HISTORY_STEPS,
} from '../utils/editHistory';
import { deleteImageHistories, loadImageHistory, moveImageHistory } from '../utils/historyStorage';
import { HslMixerProperty } from '../utils/hslMixer';
import { getCroppedDimensions } from '../utils/cropUtils';
import { getDevicePixelRatio } from '../utils/displayScale';

export type CenterMarker = 'vignette' | 'centre';

interface InteractivePatch {
  url: string;
  normX: number;
  normY: number;
  normW: number;
  normH: number;
}

interface BaseRenderSize extends ImageDimensions {
  containerHeight: number;
  containerWidth: number;
  offsetX: number;
  offsetY: number;
}

export type WgpuPhase = 'hidden' | 'arming' | 'live';

interface SavedTimeline {
  history: Adjustments[];
  labels: string[];
  times: number[];
  index: number;
}

/** How many image timelines are kept in memory at once. */
const MAX_CACHED_TIMELINES = 12;

const trimTimelineCache = (byPath: Record<string, SavedTimeline>, keep: string | null) => {
  for (const key of Object.keys(byPath)) {
    if (Object.keys(byPath).length <= MAX_CACHED_TIMELINES) break;
    if (key !== keep) delete byPath[key];
  }
};

interface EditorState {
  // Core Image & Adjustments
  selectedImage: SelectedImage | null;
  adjustments: Adjustments;
  previewOverride: Adjustments | null;

  // History State
  history: Adjustments[];
  historyLabels: string[];
  historyTimes: number[];
  historyIndex: number;
  // true while the newest change is still waiting for the debounced push
  historyDirty: boolean;
  // true while the persisted timeline for the current image is still being
  // loaded; persistence must stay off until this becomes false, otherwise a
  // fresh one-step timeline can overwrite the saved history on startup
  historyHydrating: boolean;
  // image the current timeline belongs to, and the timelines kept for
  // images switched away from earlier in the session
  historyPath: string | null;
  historyByPath: Record<string, SavedTimeline>;

  // Previews & Overlays
  finalPreviewUrl: string | null;
  uncroppedAdjustedPreviewUrl: string | null;
  interactivePatch: InteractivePatch | null;
  showOriginal: boolean;
  compareView: CompareView;
  splitPosition: number;
  originalPreview: { path: string; url: string | null } | null;

  // Analytics
  histogram: ChannelConfig | null;
  waveform: WaveformData | null;
  isWaveformVisible: boolean;
  scopeWhite: number;
  displayRevision: number;
  activeWaveformChannel: string;
  waveformHeight: number;

  // Interaction State
  isSliderDragging: boolean;
  speedEditTarget: RefObject<SpeedEditTarget | null> | null;
  isSpeedEditActive: boolean;
  zoom: number;
  displaySize: ImageDimensions;
  previewSize: ImageDimensions;
  baseRenderSize: BaseRenderSize;
  originalSize: ImageDimensions;

  // Tools State
  isRotationActive: boolean;
  overlayMode: OverlayMode;
  overlayRotation: number;
  isStraightenActive: boolean;
  isAutoStraightening: boolean;
  isWbPickerActive: boolean;
  isRelightPickerActive: boolean;
  activeRelightLightId: string | null;
  activeCenterMarker: CenterMarker | null;
  mixerPickerProperty: HslMixerProperty | null;
  isGuidedPerspectiveActive: boolean;
  liveRotation: number | null;
  cropSessionSnapshot: { path: string | null; geometry: CropGeometry } | null;
  brushSettings: BrushSettings | null;

  // Masks & AI
  activeMaskContainerId: string | null;
  activeMaskId: string | null;
  activeAiPatchContainerId: string | null;
  activeAiSubMaskId: string | null;
  isMaskControlHovered: boolean;
  isGeneratingAiMask: boolean;
  isGeneratingAi: boolean;
  aiDenoiseProgress: Record<string, number>;
  aiUpscaleProgress: Record<string, number>;
  isAIConnectorConnected: boolean;
  wgpuPhase: WgpuPhase;
  patchesSentToBackend: Set<string>;

  // Clipboard
  copiedSectionAdjustments: any | null;
  copiedMask: MaskContainer | null;
  copiedAdjustments: Adjustments | null;
  copiedAdjustmentsDefaults: Adjustments | null;
  imageDefaults: ImageDefaults | null;

  // Actions
  setEditor: (updater: Partial<EditorState> | ((state: EditorState) => Partial<EditorState>)) => void;
  pushHistory: (newAdjustments: Adjustments, label?: string, path?: string | null) => void;
  undo: () => void;
  redo: () => void;
  resetHistory: (initialState: Adjustments, path?: string | null) => void;
  stashHistory: () => void;
  goToHistoryIndex: (index: number) => void;
  beginImageHistory: (path: string, initial: Adjustments) => void;
  hydrateImageHistory: (path: string) => Promise<void>;
  resetHistoryForImage: (path: string, initial: Adjustments) => void;
  forgetImageHistory: (paths: string[]) => void;
  renameImageHistory: (oldPath: string, newPath: string) => void;
  endImageHistory: (fallback: Adjustments) => void;
}

export const getZoomContentSize = (state: Pick<EditorState, 'originalSize' | 'adjustments'>): ImageDimensions =>
  getCroppedDimensions(
    state.originalSize.width,
    state.originalSize.height,
    state.adjustments.orientationSteps || 0,
    state.adjustments.crop,
  );

export const getZoomPercent = (state: Pick<EditorState, 'originalSize' | 'adjustments' | 'displaySize'>): number => {
  const contentWidth = getZoomContentSize(state).width;
  return contentWidth > 0 && state.displaySize.width > 0
    ? (state.displaySize.width * getDevicePixelRatio()) / contentWidth
    : 1.0;
};

export const debouncedSetHistory = debounce((newAdj: Adjustments, label: string | undefined, path: string | null) => {
  const state = useEditorStore.getState();
  if (path && state.historyPath !== path) return;
  if (!areHistoryStatesEqual(state.adjustments, newAdj)) return;
  state.pushHistory(newAdj, label, path);
}, 500);

type CanvasToolState = Pick<
  EditorState,
  'isWbPickerActive' | 'isRelightPickerActive' | 'activeCenterMarker' | 'mixerPickerProperty'
>;

export const canvasToolState = (activeTool: Partial<CanvasToolState> = {}): CanvasToolState => ({
  isWbPickerActive: false,
  isRelightPickerActive: false,
  activeCenterMarker: null,
  mixerPickerProperty: null,
  ...activeTool,
});

export const useEditorStore = create<EditorState>((set, get) => ({
  selectedImage: null,
  adjustments: INITIAL_ADJUSTMENTS,
  previewOverride: null,
  history: [INITIAL_ADJUSTMENTS],
  historyLabels: [''],
  historyTimes: [Date.now()],
  historyIndex: 0,
  historyDirty: false,
  historyHydrating: false,
  historyPath: null,
  historyByPath: {},

  finalPreviewUrl: null,
  uncroppedAdjustedPreviewUrl: null,
  showOriginal: false,
  compareView: 'off',
  splitPosition: 0.5,
  originalPreview: null,
  histogram: null,
  waveform: null,
  isWaveformVisible: false,
  scopeWhite: 1,
  displayRevision: 0,
  activeWaveformChannel: 'luma',
  waveformHeight: 220,

  isSliderDragging: false,
  speedEditTarget: null,
  isSpeedEditActive: false,
  interactivePatch: null,
  activeMaskContainerId: null,
  activeMaskId: null,
  activeAiPatchContainerId: null,
  activeAiSubMaskId: null,

  zoom: 1,
  displaySize: { width: 0, height: 0 },
  previewSize: { width: 0, height: 0 },
  baseRenderSize: { width: 0, height: 0, offsetX: 0, offsetY: 0, containerWidth: 0, containerHeight: 0 },
  originalSize: { width: 0, height: 0 },

  isRotationActive: false,
  overlayMode: 'thirds',
  overlayRotation: 0,
  isStraightenActive: false,
  isAutoStraightening: false,
  isWbPickerActive: false,
  isRelightPickerActive: false,
  activeRelightLightId: null,
  activeCenterMarker: null,
  mixerPickerProperty: null,
  isGuidedPerspectiveActive: false,
  liveRotation: null,
  cropSessionSnapshot: null,

  copiedSectionAdjustments: null,
  copiedMask: null,
  brushSettings: { size: 100, feather: 50, tool: ToolType.Brush },
  copiedAdjustments: null,
  copiedAdjustmentsDefaults: null,
  imageDefaults: null,

  isGeneratingAiMask: false,
  isAIConnectorConnected: false,
  isGeneratingAi: false,
  aiDenoiseProgress: {},
  aiUpscaleProgress: {},
  isMaskControlHovered: false,
  wgpuPhase: 'hidden',
  patchesSentToBackend: new Set<string>(),

  setEditor: (updater) => set((state) => (typeof updater === 'function' ? updater(state) : updater)),

  pushHistory: (newAdj, label, path) =>
    set((state) => {
      // A debounced edit can arrive after the user switched images. Never
      // let it leak into the timeline of the new image.
      if (path && state.historyPath !== path) return state;

      const head = state.history[state.historyIndex];
      const changedKeys = getChangedAdjustmentKeys(head, newAdj);
      // Editor-only changes (tool visibility, clipping overlay) are not
      // photo edits and do not create a step.
      if (changedKeys.length === 0) return { historyDirty: false };

      const newHistory = state.history.slice(0, state.historyIndex + 1);
      const newLabels = state.historyLabels.slice(0, state.historyIndex + 1);
      const newTimes = state.historyTimes.slice(0, state.historyIndex + 1);

      newHistory.push(newAdj);
      newLabels.push(label || describeHistoryChange(head, newAdj, changedKeys));
      newTimes.push(Date.now());

      const overflow = newHistory.length - MAX_HISTORY_STEPS;
      if (overflow > 0) {
        newHistory.splice(0, overflow);
        newLabels.splice(0, overflow);
        newTimes.splice(0, overflow);
      }

      return {
        history: newHistory,
        historyLabels: newLabels,
        historyTimes: newTimes,
        historyIndex: newHistory.length - 1,
        historyDirty: false,
      };
    }),

  undo: () =>
    set((state) => {
      const head = state.history[state.historyIndex];
      // A change that is still waiting for its debounced history entry is
      // reverted first instead of skipping a whole committed step.
      if (!areHistoryStatesEqual(state.adjustments, head)) {
        return { adjustments: mergeHistoryUiState(head, state.adjustments), historyDirty: false };
      }
      if (state.historyIndex > 0) {
        const newIndex = state.historyIndex - 1;
        return {
          historyIndex: newIndex,
          adjustments: mergeHistoryUiState(state.history[newIndex], state.adjustments),
          historyDirty: false,
        };
      }
      return state;
    }),

  redo: () =>
    set((state) => {
      const head = state.history[state.historyIndex];
      if (!areHistoryStatesEqual(state.adjustments, head)) return state;
      if (state.historyIndex < state.history.length - 1) {
        const newIndex = state.historyIndex + 1;
        return {
          historyIndex: newIndex,
          adjustments: mergeHistoryUiState(state.history[newIndex], state.adjustments),
          historyDirty: false,
        };
      }
      return state;
    }),

  resetHistory: (initialState, path) => {
    if (path && get().historyPath !== path) {
      get().resetHistoryForImage(path, initialState);
      return;
    }
    const historyPath = get().historyPath;
    set((state) => {
      const byPath = { ...state.historyByPath };
      if (state.historyPath) delete byPath[state.historyPath];
      return {
        historyByPath: byPath,
        history: [initialState],
        historyLabels: [''],
        historyTimes: [Date.now()],
        historyIndex: 0,
        historyDirty: false,
        historyHydrating: false,
        adjustments: initialState,
        ...(state.cropSessionSnapshot
          ? {
              cropSessionSnapshot: {
                path: state.selectedImage?.path ?? null,
                geometry: pickCropGeometry(initialState),
              },
            }
          : {}),
      };
    });
    if (historyPath) void deleteImageHistories([historyPath]);
  },

  // persist the running timeline of the current image without leaving it;
  // used before an image switch begins so nothing in flight is lost
  stashHistory: () =>
    set((state) => {
      if (!state.historyPath || state.historyHydrating) return state;
      const byPath = { ...state.historyByPath };
      if (state.history.length > 1) {
        byPath[state.historyPath] = {
          history: state.history,
          labels: state.historyLabels,
          times: state.historyTimes,
          index: state.historyIndex,
        };
        trimTimelineCache(byPath, state.historyPath);
      }
      return { historyByPath: byPath };
    }),

  goToHistoryIndex: (index) => {
    set((state) => {
      if (index >= 0 && index < state.history.length) {
        return {
          historyIndex: index,
          adjustments: mergeHistoryUiState(state.history[index], state.adjustments),
          historyDirty: false,
        };
      }
      return state;
    });
  },

  // Switching images keeps each image's timeline for the session, so the
  // history of one picture survives going away and coming back. Timelines
  // of images that are no longer in the in-memory cache are loaded from
  // IndexedDB by hydrateImageHistory().
  beginImageHistory: (path, initial) =>
    set((state) => {
      if (state.historyPath === path) return state;

      const byPath = { ...state.historyByPath };
      if (state.historyPath && !state.historyHydrating) {
        byPath[state.historyPath] = {
          history: state.history,
          labels: state.historyLabels,
          times: state.historyTimes,
          index: state.historyIndex,
        };
      }

      const saved = byPath[path];
      if (saved) {
        // Mark as recently used so trimming keeps the current image.
        delete byPath[path];
        byPath[path] = saved;
        trimTimelineCache(byPath, path);
        return {
          historyByPath: byPath,
          historyPath: path,
          history: saved.history,
          historyLabels: saved.labels,
          historyTimes: saved.times,
          historyIndex: saved.index,
          historyDirty: false,
          historyHydrating: false,
          adjustments: saved.history[saved.index] ?? initial,
        };
      }

      trimTimelineCache(byPath, path);
      return {
        historyByPath: byPath,
        historyPath: path,
        history: [initial],
        historyLabels: [''],
        historyTimes: [Date.now()],
        historyIndex: 0,
        historyDirty: false,
        historyHydrating: true,
        adjustments: initial,
      };
    }),

  /**
   * Restores a timeline that was persisted by an earlier session. Only
   * runs while the image still shows its freshly loaded state, so an edit
   * made in the meantime is never overwritten.
   */
  hydrateImageHistory: async (path) => {
    const state = get();
    if (state.historyPath !== path) return;

    const stopHydrating = () => {
      if (get().historyPath === path && get().historyHydrating) {
        set({ historyHydrating: false });
      }
    };

    if (state.historyByPath[path]) {
      stopHydrating();
      return;
    }
    if (state.history.length > 1 || state.historyDirty) {
      stopHydrating();
      return;
    }

    const saved = await loadImageHistory(path);

    const current = get();
    if (current.historyPath !== path) return;
    if (current.history.length > 1 || current.historyDirty) {
      stopHydrating();
      return;
    }
    if (!saved || saved.history.length === 0) {
      stopHydrating();
      return;
    }

    let history = [...saved.history];
    let labels = [...saved.labels];
    let times = [...saved.times];

    // If the image's current sidecar no longer matches a saved step (for
    // example after an app upgrade, a reset, or an edit made by another
    // tool), keep the old timeline and append the current state instead of
    // throwing the user's history away.
    let index = history.findIndex((entry) => areHistoryStatesEqual(entry, current.adjustments));
    if (index < 0) {
      const previous = history[history.length - 1];
      history.push(current.adjustments);
      labels.push(previous ? describeHistoryChange(previous, current.adjustments) : '');
      times.push(Date.now());
      index = history.length - 1;
    }

    while (labels.length < history.length) labels.push('');
    while (times.length < history.length) times.push(Date.now());

    const overflow = history.length - MAX_HISTORY_STEPS;
    if (overflow > 0) {
      history = history.slice(overflow);
      labels = labels.slice(overflow);
      times = times.slice(overflow);
      index = Math.max(0, index - overflow);
    }

    set({
      history,
      historyLabels: labels,
      historyTimes: times,
      historyIndex: index,
      historyDirty: false,
      historyHydrating: false,
      adjustments: mergeHistoryUiState(history[index], current.adjustments),
    });
  },

  resetHistoryForImage: (path, initial) =>
    set((state) => {
      if (state.historyPath !== path) return state;
      if (state.historyDirty) return state;
      const head = state.history[state.historyIndex];
      // The loaded state still matches the timeline: keep its steps, but
      // adopt the tool visibility of the freshly loaded sidecar.
      if (state.history.length > 1 && areHistoryStatesEqual(head, initial)) {
        const history = [...state.history];
        history[state.historyIndex] = mergeHistoryUiState(head, initial);
        return { history, adjustments: mergeHistoryUiState(state.adjustments, initial) };
      }
      return {
        history: [initial],
        historyLabels: [''],
        historyTimes: [Date.now()],
        historyIndex: 0,
        historyDirty: false,
        adjustments: initial,
      };
    }),

  forgetImageHistory: (paths) => {
    if (paths.length === 0) return;
    set((state) => {
      const byPath = { ...state.historyByPath };
      paths.forEach((path) => delete byPath[path]);
      const touchesCurrent = state.historyPath !== null && paths.includes(state.historyPath);
      return {
        historyByPath: byPath,
        ...(touchesCurrent
          ? {
              history: [state.adjustments],
              historyLabels: [''],
              historyTimes: [Date.now()],
              historyIndex: 0,
              historyDirty: false,
              historyHydrating: false,
            }
          : {}),
      };
    });
    void deleteImageHistories(paths);
  },

  renameImageHistory: (oldPath, newPath) => {
    if (!oldPath || !newPath || oldPath === newPath) return;
    set((state) => {
      const byPath = { ...state.historyByPath };
      const saved = byPath[oldPath];
      if (saved) {
        delete byPath[oldPath];
        byPath[newPath] = saved;
      }
      if (state.historyPath === oldPath) {
        byPath[newPath] = {
          history: state.history,
          labels: state.historyLabels,
          times: state.historyTimes,
          index: state.historyIndex,
        };
        delete byPath[oldPath];
        return { historyByPath: byPath, historyPath: newPath };
      }
      return { historyByPath: byPath };
    });
    void moveImageHistory(oldPath, newPath);
  },

  endImageHistory: (fallback) =>
    set((state) => {
      const byPath = { ...state.historyByPath };
      if (state.historyPath && !state.historyHydrating) {
        byPath[state.historyPath] = {
          history: state.history,
          labels: state.historyLabels,
          times: state.historyTimes,
          index: state.historyIndex,
        };
        trimTimelineCache(byPath, state.historyPath);
      }
      return {
        historyByPath: byPath,
        historyPath: null,
        history: [fallback],
        historyLabels: [''],
        historyTimes: [Date.now()],
        historyIndex: 0,
        historyDirty: false,
        historyHydrating: false,
        adjustments: fallback,
      };
    }),
}));
