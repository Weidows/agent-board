import type { NodeProps } from '@xyflow/react';
import {
  Note,
  Link as LinkIcon,
  FolderOpen,
  CheckSquare,
  Check,
  ArrowCounterClockwise,
  PencilSimple,
  Trash,
} from '@phosphor-icons/react';
import type { Card } from './types';

export interface CardNodeData extends Record<string, unknown> {
  card: Card;
  onEdit: (id: string) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  removing?: boolean;
}

const TYPE_META = {
  note: { icon: Note, label: '笔记', chip: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' },
  link: { icon: LinkIcon, label: '链接', chip: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300' },
  file: { icon: FolderOpen, label: '文件', chip: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300' },
  task: { icon: CheckSquare, label: '任务', chip: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
} as const;

export default function CardNode({ data, selected }: NodeProps) {
  const { card, onEdit, onToggle, onDelete, removing } = data as unknown as CardNodeData;
  const meta = TYPE_META[card.type] ?? TYPE_META.note;
  const Icon = meta.icon;
  const done = card.status === 'done';

  return (
    <div
      className={`w-64 rounded-2xl border bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md dark:bg-zinc-900 ${
        removing ? 'anim-card-out' : 'anim-card-in'
      } ${
        selected
          ? 'border-emerald-600 ring-2 ring-emerald-600/30'
          : 'border-zinc-200 dark:border-zinc-800'
      }`}
    >
      <div className="flex items-center gap-1.5 px-3 pt-2.5">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.chip}`}>
          <Icon size={12} weight="bold" />
          {meta.label}
        </span>
        {done && (
          <span className="anim-chip-in rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            已完成
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5 text-zinc-400">
          {card.type === 'task' && (
            <button
              title={done ? '重开' : '完成'}
              onClick={(e) => { e.stopPropagation(); onToggle(card.id); }}
              className="rounded-md p-1 transition active:scale-90 hover:bg-zinc-100 hover:text-emerald-700 dark:hover:bg-zinc-800"
            >
              {done ? <ArrowCounterClockwise size={14} /> : <Check size={14} weight="bold" />}
            </button>
          )}
          <button
            title="编辑"
            onClick={(e) => { e.stopPropagation(); onEdit(card.id); }}
            className="rounded-md p-1 transition active:scale-90 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <PencilSimple size={14} />
          </button>
          <button
            title="删除"
            onClick={(e) => { e.stopPropagation(); onDelete(card.id); }}
            className="rounded-md p-1 transition active:scale-90 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
          >
            <Trash size={14} />
          </button>
        </div>
      </div>
      <div className="px-3 pb-1 pt-1">
        <div className={`text-sm font-semibold leading-snug text-zinc-900 transition-colors duration-200 dark:text-zinc-100 ${done ? 'line-through text-zinc-400' : ''}`}>
          {card.title || '(无标题)'}
        </div>
        {card.body && (
          <div className="mt-1 line-clamp-4 whitespace-pre-wrap break-words text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
            {card.body}
          </div>
        )}
        {card.type === 'link' && card.url && (
          <a
            href={card.url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="mt-1.5 block truncate text-xs text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400"
          >
            {card.url}
          </a>
        )}
        {card.type === 'file' && card.path && (
          <div className="mt-1.5 break-all rounded-lg bg-zinc-100 px-2 py-1 font-mono text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {card.path}
          </div>
        )}
        {card.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {card.tags.map((t) => (
              <span key={t} className="rounded-full bg-zinc-100 px-2 py-px text-[11px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                #{t}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="h-2" />
    </div>
  );
}
