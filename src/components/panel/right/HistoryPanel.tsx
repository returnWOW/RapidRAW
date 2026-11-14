import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  BookmarkPlus,
  Check,
  History as HistoryIcon,
  Redo,
  Trash2,
  Undo,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { useEditorStore } from '../../../store/useEditorStore';
import { ImageSnapshot, loadImageSnapshots, saveImageSnapshots } from '../../../utils/historyStorage';
import Text from '../../ui/Text';
import { TextColors, TextVariants } from '../../../types/typography';

type HistoryOrder = 'asc' | 'desc';

const HISTORY_ORDER_KEY = 'rapidraw.history.order';

const readHistoryOrder = (): HistoryOrder => {
  try {
    return localStorage.getItem(HISTORY_ORDER_KEY) === 'asc' ? 'asc' : 'desc';
  } catch {
    return 'desc';
  }
};

const formatHistoryTime = (timestamp: number | undefined, locale: string) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  if (isToday) return time;
  return `${date.toLocaleDateString(locale, { month: '2-digit', day: '2-digit' })} ${time}`;
};

export default function HistoryPanel() {
  const { t, i18n } = useTranslation();
  const labels = useEditorStore((s) => s.historyLabels);
  const times = useEditorStore((s) => s.historyTimes);
  const index = useEditorStore((s) => s.historyIndex);
  const historyDirty = useEditorStore((s) => s.historyDirty);
  const selectedImage = useEditorStore((s) => s.selectedImage);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const goToHistoryIndex = useEditorStore((s) => s.goToHistoryIndex);
  const listRef = useRef<HTMLDivElement>(null);
  const [order, setOrder] = useState<HistoryOrder>(() => readHistoryOrder());
  const [snapshots, setSnapshots] = useState<ImageSnapshot[]>([]);
  const [isNamingSnapshot, setIsNamingSnapshot] = useState(false);
  const [snapshotName, setSnapshotName] = useState('');

  const rowIndices = useMemo(() => {
    const indices = labels.map((_, i) => i);
    return order === 'desc' ? indices.reverse() : indices;
  }, [labels, order]);

  const toggleOrder = () => {
    setOrder((previous) => {
      const next: HistoryOrder = previous === 'desc' ? 'asc' : 'desc';
      try {
        localStorage.setItem(HISTORY_ORDER_KEY, next);
      } catch {
        // Storage can be unavailable; the toggle still works for this session.
      }
      return next;
    });
  };

  const fileName = useMemo(() => {
    if (!selectedImage?.path) return '';
    const cleanPath = selectedImage.path.split('?')[0];
    return cleanPath.split(/[\\/]/).pop() || cleanPath;
  }, [selectedImage?.path]);

  useEffect(() => {
    let isActive = true;
    const path = selectedImage?.path;
    setIsNamingSnapshot(false);
    setSnapshotName('');
    setSnapshots([]);
    if (!path) return;

    loadImageSnapshots(path).then((list) => {
      if (isActive) setSnapshots(list);
    });
    return () => {
      isActive = false;
    };
  }, [selectedImage?.path]);

  const beginSnapshot = () => {
    setSnapshotName(t('ui.history.snapshotDefaultName', { number: snapshots.length + 1 }));
    setIsNamingSnapshot(true);
  };

  const cancelSnapshot = () => {
    setIsNamingSnapshot(false);
    setSnapshotName('');
  };

  const handleSaveSnapshot = async () => {
    const path = selectedImage?.path;
    if (!path) return;
    const name = snapshotName.trim() || t('ui.history.snapshotDefaultName', { number: snapshots.length + 1 });
    const snapshot: ImageSnapshot = {
      id: crypto.randomUUID(),
      name,
      time: Date.now(),
      adjustments: JSON.parse(JSON.stringify(useEditorStore.getState().adjustments)),
      historyIndex: index,
    };
    const next = [...snapshots, snapshot];
    setSnapshots(next);
    setIsNamingSnapshot(false);
    setSnapshotName('');
    await saveImageSnapshots(path, next);
  };

  const handleDeleteSnapshot = (id: string) => {
    const path = selectedImage?.path;
    if (!path) return;
    const next = snapshots.filter((snapshot) => snapshot.id !== id);
    setSnapshots(next);
    void saveImageSnapshots(path, next);
  };

  const handleRestoreSnapshot = (snapshot: ImageSnapshot) => {
    const path = selectedImage?.path;
    if (!path) return;
    const restored = JSON.parse(JSON.stringify(snapshot.adjustments));
    useEditorStore.getState().setEditor({
      adjustments: restored,
      historyDirty: false,
      showOriginal: false,
      previewOverride: null,
    });
    useEditorStore.getState().pushHistory(restored, t('ui.history.snapshotLabel', { name: snapshot.name }), path);
  };

  useEffect(() => {
    listRef.current?.querySelector(`[data-history-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index, labels.length, order]);

  if (!selectedImage) {
    return (
      <div className="flex flex-col h-full">
        <div className="p-3 flex justify-between items-center shrink-0 border-b border-surface">
          <Text variant={TextVariants.title}>{t('ui.history.title')}</Text>
        </div>
        <div className="grow flex items-center justify-center p-6">
          <Text variant={TextVariants.heading} color={TextColors.secondary} className="text-center">
            {t('ui.history.noImage')}
          </Text>
        </div>
      </div>
    );
  }

  const canUndo = index > 0 || historyDirty;
  const canRedo = !historyDirty && index < labels.length - 1;

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 flex justify-between items-center shrink-0 border-b border-surface">
        <div className="min-w-0">
          <Text variant={TextVariants.title}>{t('ui.history.title')}</Text>
          <Text
            variant={TextVariants.small}
            color={TextColors.secondary}
            className="block truncate mt-0.5"
            data-tooltip={selectedImage.path}
          >
            {fileName}
            <span className="opacity-60"> · {t('ui.history.steps', { count: labels.length })}</span>
          </Text>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={toggleOrder}
            className="p-2 rounded-full hover:bg-surface text-text-secondary hover:text-text-primary transition-colors"
            data-tooltip={order === 'desc' ? t('ui.history.showOldestFirst') : t('ui.history.showNewestFirst')}
            aria-label={order === 'desc' ? t('ui.history.showOldestFirst') : t('ui.history.showNewestFirst')}
          >
            {order === 'desc' ? <ArrowDownWideNarrow size={18} /> : <ArrowUpNarrowWide size={18} />}
          </button>
          <button
            onClick={undo}
            disabled={!canUndo}
            className="p-2 rounded-full hover:bg-surface text-text-secondary hover:text-text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            data-tooltip={t('ui.history.undo')}
          >
            <Undo size={18} />
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="p-2 rounded-full hover:bg-surface text-text-secondary hover:text-text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            data-tooltip={t('ui.history.redo')}
          >
            <Redo size={18} />
          </button>
        </div>
      </div>

      <div ref={listRef} className="grow overflow-y-auto p-2 custom-scrollbar">
        <div className="mb-2">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary/80">
              {t('ui.history.snapshots')}
            </span>
            <button
              onClick={beginSnapshot}
              className="p-1 rounded-md text-text-secondary hover:bg-surface hover:text-text-primary transition-colors"
              data-tooltip={t('ui.history.saveSnapshot')}
              aria-label={t('ui.history.saveSnapshot')}
            >
              <BookmarkPlus size={14} />
            </button>
          </div>

          {isNamingSnapshot && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void handleSaveSnapshot();
              }}
              className="flex items-center gap-1 px-2 pb-2"
            >
              <input
                autoFocus
                value={snapshotName}
                onChange={(event) => setSnapshotName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return;
                  event.stopPropagation();
                  cancelSnapshot();
                }}
                placeholder={t('ui.history.snapshotName')}
                className="flex-1 min-w-0 bg-bg-tertiary text-text-primary text-xs rounded-md px-2 py-1 placeholder:text-text-secondary/70 focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <button
                type="submit"
                className="p-1 rounded-md text-text-secondary hover:bg-surface hover:text-text-primary transition-colors"
                data-tooltip={t('ui.history.save')}
              >
                <Check size={14} />
              </button>
              <button
                type="button"
                onClick={cancelSnapshot}
                className="p-1 rounded-md text-text-secondary hover:bg-surface hover:text-text-primary transition-colors"
                data-tooltip={t('ui.history.cancel')}
              >
                <X size={14} />
              </button>
            </form>
          )}

          {snapshots.length === 0 ? (
            !isNamingSnapshot && (
              <div className="px-2 pb-1 text-[10px] text-text-secondary/60">{t('ui.history.noSnapshots')}</div>
            )
          ) : (
            <div className="flex flex-col gap-0.5">
              {snapshots.map((snapshot) => (
                <div
                  key={snapshot.id}
                  className="group flex items-center gap-1 px-2 py-1 rounded-md hover:bg-surface/60 transition-colors"
                >
                  <button
                    onClick={() => handleRestoreSnapshot(snapshot)}
                    className="flex-1 min-w-0 text-left"
                    data-tooltip={t('ui.history.restoreSnapshot')}
                  >
                    <span className="block truncate text-xs text-text-secondary group-hover:text-text-primary">
                      {snapshot.name}
                    </span>
                    <span className="block text-[10px] text-text-secondary/60 tabular-nums">
                      {formatHistoryTime(snapshot.time, i18n.language)}
                    </span>
                  </button>
                  <button
                    onClick={() => handleDeleteSnapshot(snapshot.id)}
                    className="p-1 rounded-md text-text-secondary opacity-60 md:opacity-0 md:group-hover:opacity-100 hover:text-red-400 transition-all"
                    data-tooltip={t('ui.history.deleteSnapshot')}
                    aria-label={t('ui.history.deleteSnapshot')}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-surface/60 mx-2 mb-2" />

        {labels.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-4">
            <HistoryIcon size={20} className="text-text-secondary opacity-50" />
            <Text variant={TextVariants.small} color={TextColors.secondary}>
              {t('ui.history.noEdits')}
            </Text>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {rowIndices.map((i) => {
              const label = labels[i];
              const isCurrent = i === index;
              const isFuture = i > index;
              const displayLabel = label || t('ui.history.initial');
              return (
                <button
                  key={`${i}-${times[i] ?? 0}`}
                  data-history-index={i}
                  onClick={() => goToHistoryIndex(i)}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors',
                    isCurrent
                      ? 'bg-surface text-text-primary'
                      : 'text-text-secondary hover:bg-surface/60 hover:text-text-primary',
                    isFuture && 'opacity-45',
                  )}
                  data-tooltip={displayLabel}
                >
                  <span
                    className={clsx(
                      'w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-[10px] tabular-nums transition-colors',
                      isCurrent ? 'bg-accent text-button-text' : 'bg-surface/70 text-text-secondary',
                    )}
                  >
                    {i}
                  </span>
                  <span className={clsx('flex-1 min-w-0 truncate text-xs', isCurrent ? 'font-medium' : 'font-normal')}>
                    {displayLabel}
                  </span>
                  <span className="shrink-0 text-[10px] tabular-nums opacity-50">
                    {formatHistoryTime(times[i], i18n.language)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
