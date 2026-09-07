import { useState } from 'react';
import type { Card, CardStatus, CardType } from './types';

interface Props {
  card: Card;
  onSave: (id: string, d: Partial<Card>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}

export default function Editor({ card, onSave, onDelete, onClose }: Props) {
  const [title, setTitle] = useState(card.title);
  const [type, setType] = useState<CardType>(card.type);
  const [status, setStatus] = useState<CardStatus>(card.status);
  const [body, setBody] = useState(card.body);
  const [url, setUrl] = useState(card.url);
  const [path, setPath] = useState(card.path);
  const [tags, setTags] = useState(card.tags.join(', '));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    setBusy(true); setErr('');
    try {
      await onSave(card.id, {
        title, type, status, body,
        url: url.trim(), path: path.trim(),
        tags: tags.split(',').map((s) => s.trim()).filter(Boolean),
      });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const input = 'w-full rounded-lg border border-zinc-200 bg-transparent px-2.5 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:text-zinc-100';
  const label = 'mb-1 mt-3 block text-xs text-zinc-500 dark:text-zinc-400';

  return (
    <div className="absolute right-3 top-3 z-10 w-72 rounded-2xl border border-zinc-200 bg-white p-4 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">编辑卡片</span>
        <button onClick={onClose} className="rounded-md px-2 py-0.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">✕</button>
      </div>
      <label className={label}>标题</label>
      <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div>
          <label className={label}>类型</label>
          <select className={input} value={type} onChange={(e) => setType(e.target.value as CardType)}>
            <option value="note">note 笔记</option>
            <option value="link">link 链接</option>
            <option value="file">file 文件</option>
            <option value="task">task 任务</option>
          </select>
        </div>
        <div>
          <label className={label}>状态</label>
          <select className={input} value={status} onChange={(e) => setStatus(e.target.value as CardStatus)}>
            <option value="open">open</option>
            <option value="done">done</option>
          </select>
        </div>
      </div>
      <label className={label}>正文</label>
      <textarea className={`${input} min-h-20`} value={body} onChange={(e) => setBody(e.target.value)} />
      <label className={label}>链接 URL</label>
      <input className={input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
      <label className={label}>本地路径 path</label>
      <input className={`${input} font-mono text-xs`} value={path} onChange={(e) => setPath(e.target.value)} placeholder="C:\…\result.csv" />
      <label className={label}>标签（逗号分隔）</label>
      <input className={input} value={tags} onChange={(e) => setTags(e.target.value)} />
      {err && <div className="mt-2 text-xs text-red-600">{err}</div>}
      <div className="mt-4 flex gap-2">
        <button
          onClick={save} disabled={busy}
          className="flex-1 rounded-full bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          保存
        </button>
        <button
          onClick={() => { if (confirm('删除这张卡片？')) onDelete(card.id).then(onClose); }}
          className="flex-1 rounded-full border border-zinc-200 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          删除
        </button>
      </div>
    </div>
  );
}
