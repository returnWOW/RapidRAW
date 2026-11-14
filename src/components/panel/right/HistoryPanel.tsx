import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, History as HistoryIcon, Redo, Undo } from 'lucide-react';
import clsx from 'clsx';
import { useEditorStore } from '../../../store/useEditorStore';
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
