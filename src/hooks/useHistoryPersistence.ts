import { useEffect } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { HistoryTimeline, saveImageHistory } from '../utils/historyStorage';
import { debouncedSetHistory } from './useEditorActions';

/** Delay before a changed timeline is written to IndexedDB. */
const PERSIST_DELAY = 700;

/**
 * Mirrors the editor's per-image timelines into IndexedDB.
 *
 * The store itself stays synchronous; persistence happens here so the UI
 * never waits for disk writes. A timeline is written when it changes and
 * immediately when its image is left, which also covers switching back to
 * the library and closing the editor.
 */
export function useHistoryPersistence() {
  useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const pending = new Map<string, HistoryTimeline>();

    const flush = (path: string) => {
      const timer = timers.get(path);
      if (timer) clearTimeout(timer);
      timers.delete(path);
      const timeline = pending.get(path);
      pending.delete(path);
      if (timeline) void saveImageHistory(path, timeline);
    };

    const flushAll = () => {
      for (const path of Array.from(pending.keys())) flush(path);
    };

    const schedule = (path: string, timeline: HistoryTimeline) => {
      pending.set(path, timeline);
      const timer = timers.get(path);
      if (timer) clearTimeout(timer);
      timers.set(
        path,
        setTimeout(() => flush(path), PERSIST_DELAY),
      );
    };

    const unsubscribe = useEditorStore.subscribe((state, previous) => {
      // Write the image that was just left before handling the new one.
      if (previous.historyPath && previous.historyPath !== state.historyPath) {
        schedule(previous.historyPath, {
          history: previous.history,
          labels: previous.historyLabels,
          times: previous.historyTimes,
          index: previous.historyIndex,
        });
        flush(previous.historyPath);
      }

      const timelineChanged =
        state.history !== previous.history ||
        state.historyLabels !== previous.historyLabels ||
        state.historyTimes !== previous.historyTimes ||
        state.historyIndex !== previous.historyIndex;

      if (state.historyPath && timelineChanged) {
        schedule(state.historyPath, {
          history: state.history,
          labels: state.historyLabels,
          times: state.historyTimes,
          index: state.historyIndex,
        });
      }
    });

    const flushPending = () => {
      // Commit an edit that is still waiting for its history debounce, so
      // closing or minimising cannot drop the newest step.
      debouncedSetHistory.flush();
      flushAll();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushPending();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', flushPending);

    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', flushPending);
      flushPending();
    };
  }, []);
}
