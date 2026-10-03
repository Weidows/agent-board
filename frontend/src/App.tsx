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
import { Plus, SquaresFour, MagnifyingGlass, ArrowClockwise, ArrowUUpLeft, ArrowUUpRight, Keyboard } from '@phosphor-icons/react';
import { api } from './api';
import type { Board, Card, State } from './types';
import CardNode, { type CardNodeData } from './CardNode';
import Editor from './Editor';

type CardNodeT = Node<CardNodeData, 'card'>;

const nodeTypes = { card: CardNode };

/** 撤销/重做快照：整个卡片+画布列表（内容以服务端为准对账） */
interface Snapshot {
  cards: Card[];
  boards: Board[];
}
interface HistoryEntry {
  label: string;
  snap: Snapshot;
}
const HISTORY_MAX = 50;

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
  const [help, setHelp] = useState(false);
  const [past, setPast] = useState<HistoryEntry[]>([]);
  const [future, setFuture] = useState<HistoryEntry[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const selectedRef = useRef<string[]>([]);
  const applyingRef = useRef(false);
  const deletingRef = useRef<Set<string>>(new Set());
  // 每次渲染都镜像最新数据，供历史栈取“变更前”快照（避免闭包过期）
  const stateRef = useRef<Snapshot>({ cards: [], boards: [] });
  stateRef.current = { cards, boards };

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

  const pushHistory = useCallback((label: string) => {
    const snap = stateRef.current;
    setPast((p) => [...p.slice(-(HISTORY_MAX - 1)), { label, snap }]);
    setFuture([]);
  }, []);

  /** 把本地+服务端一起恢复到 target 快照：按 id 对账，POST 不认自建 id，重建时做 id 重映射 */
  const applySnapshot = useCallback(
    async (target: Snapshot) => {
      const cur = stateRef.current;
      setCards(target.cards);
      setBoards(target.boards);
      stateRef.current = target;
      setEditing((e) => (e ? (target.cards.find((c) => c.id === e.id) ?? null) : null));
      const idMap = new Map<string, string>();
      try {
        // 先补回被删画布（卡片依赖 board_id）
        for (const b of target.boards) {
          if (!cur.boards.some((x) => x.id === b.id)) {
            const nb = await api.createBoard(b.title, b.desc);
            idMap.set(b.id, nb.id);
          }
        }
        for (const b of cur.boards) {
          if (!target.boards.some((x) => x.id === b.id)) await api.deleteBoard(b.id);
        }
        for (const b of target.boards) {
          const id = idMap.get(b.id) ?? b.id;
          const prev = cur.boards.find((x) => x.id === id);
          if (prev && (prev.title !== b.title || prev.desc !== b.desc)) {
            await api.patchBoard(id, { title: b.title, desc: b.desc });
          }
        }
        // 卡片：目标里有而当前没有 → 重建（board_id 走重映射）
        for (const c of target.cards) {
          if (!cur.cards.some((x) => x.id === c.id)) {
            const boardId = idMap.get(c.board_id) ?? c.board_id;
            const nc = await api.createCard({ ...c, board_id: boardId });
            idMap.set(c.id, nc.id);
            const newId = nc.id;
            setCards((cs) => cs.map((x) => (x.id === c.id ? nc : x)));
            stateRef.current = { ...stateRef.current, cards: stateRef.current.cards.map((x) => (x.id === c.id ? nc : x)) };
            void newId;
          } else {
            const prev = cur.cards.find((x) => x.id === c.id)!;
            const same =
              prev.title === c.title && prev.body === c.body && prev.type === c.type &&
              prev.status === c.status && prev.url === c.url && prev.path === c.path &&
              prev.x === c.x && prev.y === c.y &&
              JSON.stringify(prev.tags) === JSON.stringify(c.tags);
            if (!same) {
              const nb = idMap.get(c.board_id) ?? c.board_id;
              const saved = await api.patchCard(c.id, {
                title: c.title, body: c.body, type: c.type, status: c.status,
                url: c.url, path: c.path, x: c.x, y: c.y, tags: c.tags, board_id: nb,
              });
              setCards((cs) => cs.map((x) => (x.id === c.id ? saved : x)));
              stateRef.current = { ...stateRef.current, cards: stateRef.current.cards.map((x) => (x.id === c.id ? saved : x)) };
            }
          }
        }
        for (const c of cur.cards) {
          if (!target.cards.some((x) => x.id === c.id)) await api.deleteCard(c.id);
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : '撤销同步失败');
        reload().catch(() => undefined); // 对账出错就整表重载兜底
      }
    },
    [reload],
  );

  const undo = useCallback(async () => {
    if (applyingRef.current) return;
    const entry = past[past.length - 1];
    if (!entry) return;
    applyingRef.current = true;
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [...f, { label: entry.label, snap: stateRef.current }]);
    try {
      await applySnapshot(entry.snap);
    } finally {
      applyingRef.current = false;
    }
  }, [past, applySnapshot]);

  const redo = useCallback(async () => {
    if (applyingRef.current) return;
    const entry = future[future.length - 1];
    if (!entry) return;
    applyingRef.current = true;
    setFuture((f) => f.slice(0, -1));
    setPast((p) => [...p, { label: entry.label, snap: stateRef.current }]);
    try {
      await applySnapshot(entry.snap);
    } finally {
      applyingRef.current = false;
    }
  }, [future, applySnapshot]);

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
      pushHistory('切换状态');
      setCards((cs) => cs.map((x) => (x.id === id ? next : x)));
      setEditing((e) => (e?.id === id ? next : e));
    },
    [cards],
  );

  // 删除：先播退场动画（~190ms），再真正调接口；失败则卡片“弹回”并提示
  const removeCard = useCallback(async (id: string) => {
    // 已不存在 / 删除进行中 → 跳过，避免重复删除污染历史栈
    if (deletingRef.current.has(id) || !stateRef.current.cards.some((c) => c.id === id)) return;
    deletingRef.current.add(id);
    setRemoving((s) => new Set(s).add(id));
    await new Promise((r) => window.setTimeout(r, 190));
    try {
      await api.deleteCard(id);
      pushHistory('删除卡片');
      setCards((cs) => cs.filter((x) => x.id !== id));
      setEditing((e) => (e?.id === id ? null : e));
    } catch {
      setErr('删除失败');
    } finally {
      deletingRef.current.delete(id);
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
        pushHistory('移动卡片');
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
    pushHistory('新建卡片');
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
        pushHistory('新建卡片');
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
    pushHistory('新建画布');
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

  // 全局快捷键（输入框内只放行撤销类，避免抢浏览器原生行为）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t?.closest?.('input, textarea, select, [contenteditable="true"]');
      const mod = e.ctrlKey || e.metaKey;
      if (!typing && mod && e.code === 'KeyZ') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (!typing && mod && e.code === 'KeyY') {
        e.preventDefault();
        redo();
        return;
      }
      if (e.key === 'Escape') {
        if (help) setHelp(false);
        else if (editing) setEditing(null);
        else if (selectedRef.current.length) {
          selectedRef.current = [];
          setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
        }
        return;
      }
      if (typing) return;
      if (mod && e.code === 'KeyN') {
        e.preventDefault();
        addCard();
        return;
      }
      if (mod && e.code === 'KeyF') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // 优先删选中的；选中态被重建清掉时退回到正打开的编辑对象
        const targets = selectedRef.current.length ? [...selectedRef.current] : editing ? [editing.id] : [];
        if (!targets.length) return;
        e.preventDefault();
        for (const id of targets) removeCard(id);
      }
    };
    // 捕获阶段监听，避免被 React Flow 等内层 stopPropagation 吃掉
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [undo, redo, addCard, removeCard, help, editing]);

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
                if (t)
                  api.patchBoard(b.id, { title: t }).then(() => {
                    pushHistory('重命名画布');
                    reload();
                  });
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
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="过滤 卡片/标签…"
              className="w-full rounded-lg border border-zinc-200 bg-transparent py-1 pl-7 pr-2 text-sm transition focus:border-emerald-600/70 focus:outline-none focus:ring-2 focus:ring-emerald-600/15 dark:border-zinc-700"
            />
          </div>
          {/* 撤销 / 重做 */}
      <div className="flex shrink-0 gap-1">
        <button
          onClick={undo}
          disabled={!past.length}
          title="撤销 Ctrl+Z"
          className="rounded-full border border-zinc-200 p-1.5 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-35 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          <ArrowUUpLeft size={14} />
        </button>
        <button
          onClick={redo}
          disabled={!future.length}
          title="重做 Ctrl+Shift+Z"
          className="rounded-full border border-zinc-200 p-1.5 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-35 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          <ArrowUUpRight size={14} />
        </button>
        <button
          onClick={() => setHelp((h) => !h)}
          title="快捷键"
          className={`rounded-full border p-1.5 transition ${
            help
              ? 'border-emerald-600 bg-emerald-600 text-white'
              : 'border-zinc-200 hover:bg-white dark:border-zinc-700 dark:hover:bg-zinc-900'
          }`}
        >
          <Keyboard size={14} />
        </button>
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

        <div className="relative min-h-0 flex-1 overflow-hidden">
          <ReactFlow
            nodes={nodes}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onNodeClick={onNodeClick}
            onNodeDragStop={onNodeDragStop}
            onSelectionChange={({ nodes }) => {
              selectedRef.current = nodes.map((n) => n.id);
            }}
            deleteKeyCode={null}
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
          {help && (
            <div className="anim-board-in absolute left-3 top-3 z-20 w-60 rounded-2xl border border-zinc-200 bg-white p-3 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              <div className="mb-1.5 font-semibold text-zinc-900 dark:text-zinc-100">快捷键</div>
              {[
                ['Ctrl+Z', '撤销'],
                ['Ctrl+Shift+Z / Ctrl+Y', '重做'],
                ['Ctrl+N', '新建卡片'],
                ['Ctrl+F', '定位搜索框'],
                ['Delete', '删除选中卡片'],
                ['Esc', '关闭面板 / 取消选中'],
                ['Ctrl+S / Ctrl+Enter', '编辑面板保存'],
              ].map(([k, d]) => (
                <div key={k} className="flex items-center justify-between gap-2 py-0.5">
                  <span className="text-zinc-500 dark:text-zinc-400">{d}</span>
                  <kbd className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    {k}
                  </kbd>
                </div>
              ))}
            </div>
          )}
          {editing && (
            <Editor
              key={editing.id}
              card={editing}
              onSave={async (id, d) => {
                const next = await api.patchCard(id, d);
                pushHistory('编辑卡片');
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
