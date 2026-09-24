import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  applyNodeChanges,
  useReactFlow,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Plus, SquaresFour, MagnifyingGlass, ArrowClockwise } from '@phosphor-icons/react';
import { api } from './api';
import type { Board, Card, State } from './types';
import CardNode, { type CardNodeData } from './CardNode';
import Editor from './Editor';

type CardNodeT = Node<CardNodeData, 'card'>;

const nodeTypes = { card: CardNode };

export function Board() {
  const { screenToFlowPosition, fitView } = useReactFlow();
  const [boards, setBoards] = useState<Board[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [cur, setCur] = useState<string | null>(null);
  const [nodes, setNodes] = useState<CardNodeT[]>([]);
  const [ftype, setFtype] = useState('');
  const [q, setQ] = useState('');
  const [nbTitle, setNbTitle] = useState('');
  const [editing, setEditing] = useState<Card | null>(null);
  const [err, setErr] = useState('');
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set());

  const reload = useCallback(async () => {
    const s: State = await api.state();
    let bs = s.boards;
    if (!bs.length) {
      const b = await api.createBoard('我的项目');
      bs = [b];
      s.boards = bs;
    }
    setBoards(bs);
    setCards(s.cards);
    setCur((c) => (c && bs.some((b) => b.id === c) ? c : bs[0].id));
  }, []);

  useEffect(() => {
    reload().catch((e) => setErr(e instanceof Error ? e.message : '加载失败'));
  }, [reload]);

  // 错误 toast 自动消失（重复报错靠 key 重挂载重播动画）
  useEffect(() => {
    if (!err) return;
    const t = window.setTimeout(() => setErr(''), 3500);
    return () => window.clearTimeout(t);
  }, [err]);

  const visible = useMemo(
    () =>
      cards.filter((c) => {
        if (c.board_id !== cur) return false;
        if (ftype && c.type !== ftype) return false;
        const t = q.trim().toLowerCase();
        if (t && !(c.title + c.body + c.tags.join(' ')).toLowerCase().includes(t)) return false;
        return true;
      }),
    [cards, cur, ftype, q],
  );

  const onEdit = useCallback(
    (id: string) => setEditing(cards.find((c) => c.id === id) ?? null),
    [cards],
  );
  const onToggle = useCallback(
    async (id: string) => {
      const c = cards.find((x) => x.id === id);
      if (!c) return;
      const next = await api.patchCard(id, { status: c.status === 'done' ? 'open' : 'done' });
      setCards((cs) => cs.map((x) => (x.id === id ? next : x)));
      setEditing((e) => (e?.id === id ? next : e));
    },
    [cards],
  );

  // 删除：先播退场动画（~190ms），再真正调接口；失败则卡片“弹回”并提示
  const removeCard = useCallback(async (id: string) => {
    setRemoving((s) => new Set(s).add(id));
    await new Promise((r) => window.setTimeout(r, 190));
    try {
      await api.deleteCard(id);
      setCards((cs) => cs.filter((x) => x.id !== id));
      setEditing((e) => (e?.id === id ? null : e));
    } catch {
      setErr('删除失败');
    } finally {
      setRemoving((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  }, []);

  useEffect(() => {
    setNodes(
      visible.map((c) => ({
        id: c.id,
        type: 'card',
        position: { x: c.x, y: c.y },
        data: { card: c, onEdit, onToggle, onDelete: removeCard, removing: removing.has(c.id) },
      })),
    );
  }, [visible, onEdit, onToggle, removeCard, removing]);

  // 切换画布时镜头平滑飞过去，而不是瞬间跳变
  const prevBoard = useRef<string | null>(null);
  useEffect(() => {
    if (prevBoard.current !== null && prevBoard.current !== cur) {
      const t = window.setTimeout(() => {
        fitView({ duration: 650, padding: 0.25, maxZoom: 1.2 });
      }, 60);
      prevBoard.current = cur;
      return () => window.clearTimeout(t);
    }
    prevBoard.current = cur;
    return undefined;
  }, [cur, fitView]);

  const onNodesChange = useCallback((changes: NodeChange<CardNodeT>[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns) as CardNodeT[]);
  }, []);

  const onNodeClick = useCallback(
    (e: React.MouseEvent, node: CardNodeT) => {
      // 卡片内按钮/链接的点击不触发编辑（按钮自己已 stopPropagation，这里再保险一层）
      if ((e.target as HTMLElement).closest?.('button, a')) return;
      setEditing(cards.find((c) => c.id === node.id) ?? null);
    },
    [cards],
  );

  const onNodeDragStop = useCallback(
    async (_event: MouseEvent | TouchEvent, node: CardNodeT) => {
      const { x, y } = node.position;
      try {
        const next = await api.patchCard(node.id, {
          x: Math.round(x),
          y: Math.round(y),
        });
        setCards((cs) => cs.map((c) => (c.id === node.id ? next : c)));
      } catch {
        setErr('位置保存失败');
      }
    },
    [],
  );

  const nextPos = useCallback(() => {
    const mine = cards.filter((c) => c.board_id === cur);
    return { x: 40 + (mine.length % 4) * 300, y: 40 + Math.floor(mine.length / 4) * 260 };
  }, [cards, cur]);

  const addCard = useCallback(async () => {
    if (!cur) return;
    const p = nextPos();
    const c = await api.createCard({ board_id: cur, type: 'note', title: '新卡片', ...p });
    setCards((cs) => [...cs, c]);
    setEditing(c);
  }, [cur, nextPos]);

  const onPaneDoubleClick = useCallback(
    async (e: React.MouseEvent) => {
      if (!cur) return;
      // 卡片上的双击冒泡到这里：落在 node 内的直接忽略，由卡片自己处理（打开编辑）
      if ((e.target as HTMLElement).closest?.('.react-flow__node')) return;
      try {
        const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        const c = await api.createCard({
          board_id: cur, type: 'note', title: '新卡片',
          x: Math.round(p.x), y: Math.round(p.y),
        });
        setCards((cs) => [...cs, c]);
        setEditing(c);
      } catch (err2) {
        setErr(err2 instanceof Error ? err2.message : '新建失败');
      }
    },
    [cur, screenToFlowPosition],
  );

  const createBoard = async () => {
    const t = nbTitle.trim();
    if (!t) return;
    const b = await api.createBoard(t);
    setBoards((bs) => [...bs, b]);
    setNbTitle('');
    setCur(b.id);
  };

  const board = boards.find((b) => b.id === cur);
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of cards) m[c.board_id] = (m[c.board_id] ?? 0) + 1;
    return m;
  }, [cards]);

  return (
    <div className="flex h-dvh bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <aside className="flex w-56 min-w-56 flex-col border-r border-zinc-200 dark:border-zinc-800">
        <div className="px-4 pb-1 pt-4">
          <div className="text-[15px] font-bold">agent-board</div>
          <div className="mt-0.5 text-xs text-zinc-500">项目 = 画布 · 万物 = 卡片</div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {boards.map((b, i) => (
            <div
              key={b.id}
              onClick={() => setCur(b.id)}
              onDoubleClick={() => {
                const t = prompt('重命名画布', b.title);
                if (t) api.patchBoard(b.id, { title: t }).then(reload);
              }}
              style={{ animationDelay: `${i * 45}ms` }}
              className={`anim-board-in mb-1.5 cursor-pointer rounded-xl border px-3 py-2 transition-all duration-200 hover:-translate-y-px hover:shadow-sm ${
                b.id === cur
                  ? 'border-emerald-600 bg-white shadow-sm dark:bg-zinc-900'
                  : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700'
              }`}
            >
              <div className="truncate text-sm font-semibold">{b.title} ({counts[b.id] ?? 0})</div>
              {b.desc && <div className="truncate text-xs text-zinc-500">{b.desc}</div>}
            </div>
          ))}
        </div>
        <div className="flex gap-1.5 p-2">
          <input
            value={nbTitle}
            onChange={(e) => setNbTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createBoard()}
            placeholder="新建项目画布…"
            className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-transparent px-2 py-1.5 text-sm transition focus:border-emerald-600/70 focus:outline-none focus:ring-2 focus:ring-emerald-600/15 dark:border-zinc-700"
          />
          <button
            onClick={createBoard}
            className="rounded-lg bg-emerald-600 px-2.5 text-white transition hover:bg-emerald-700 active:scale-95"
          >
            <Plus size={15} weight="bold" />
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 max-w-full items-center gap-2 border-b border-zinc-200 px-3 dark:border-zinc-800">
          <SquaresFour size={17} className="shrink-0 text-zinc-400" />
          <span key={board?.id ?? 'none'} className="anim-fade-in truncate text-[15px] font-bold">
            {board?.title ?? '—'}
          </span>
          <select
            value={ftype}
            onChange={(e) => setFtype(e.target.value)}
            className="shrink-0 rounded-lg border border-zinc-200 bg-transparent px-2 py-1 text-sm transition focus:border-emerald-600/70 focus:outline-none dark:border-zinc-700"
          >
            <option value="">全部类型</option>
            <option value="note">笔记</option>
            <option value="link">链接</option>
            <option value="file">文件</option>
            <option value="task">任务</option>
          </select>
          <div className="relative min-w-0 flex-1 sm:max-w-52">
            <MagnifyingGlass size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="过滤 卡片/标签…"
              className="w-full rounded-lg border border-zinc-200 bg-transparent py-1 pl-7 pr-2 text-sm transition focus:border-emerald-600/70 focus:outline-none focus:ring-2 focus:ring-emerald-600/15 dark:border-zinc-700"
            />
          </div>
          <div className="ml-auto flex shrink-0 gap-1.5">
            <button
              onClick={() => reload().catch((e) => setErr(e instanceof Error ? e.message : '刷新失败'))}
              title="刷新"
              className="group rounded-full border border-zinc-200 p-1.5 transition hover:bg-white dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              <ArrowClockwise size={14} className="transition-transform duration-500 group-hover:rotate-180" />
            </button>
            <button
              onClick={addCard}
              className="rounded-full bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-700 hover:shadow-md active:scale-95"
            >
              + 卡片
            </button>
          </div>
        </div>

        <div className="relative min-h-0 flex-1">
          <ReactFlow
            nodes={nodes}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onNodeClick={onNodeClick}
            onNodeDragStop={onNodeDragStop}
            onDoubleClick={onPaneDoubleClick}
            zoomOnDoubleClick={false}
            fitView
            minZoom={0.3}
            maxZoom={2.5}
            proOptions={{ hideAttribution: false }}
          >
            <Background gap={24} color="#d4d4d8" />
            <Controls position="bottom-left" />
            <MiniMap position="bottom-right" pannable zoomable />
          </ReactFlow>
          {editing && (
            <Editor
              key={editing.id}
              card={editing}
              onSave={async (id, d) => {
                const next = await api.patchCard(id, d);
                setCards((cs) => cs.map((c) => (c.id === id ? next : c)));
              }}
              onDelete={removeCard}
              onClose={() => setEditing(null)}
            />
          )}
          {err && (
            <div
              key={err}
              className="anim-toast-in absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-zinc-900 px-4 py-1.5 text-xs text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900"
            >
              {err}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Board />
    </ReactFlowProvider>
  );
}
