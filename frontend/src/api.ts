import type { Board, Card, State } from './types';

async function req<T>(method: string, url: string, data?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error || String(r.status));
  return body as T;
}

export const api = {
  state: () => req<State>('GET', '/api/state'),
  createBoard: (title: string, desc = '') =>
    req<Board>('POST', '/api/boards', { title, desc }),
  patchBoard: (id: string, d: Partial<Board>) =>
    req<Board>('PATCH', `/api/boards/${id}`, d),
  deleteBoard: (id: string) => req<{ ok: true }>('DELETE', `/api/boards/${id}`),
  createCard: (d: Partial<Card> & { board_id: string }) =>
    req<Card>('POST', '/api/cards', d),
  patchCard: (id: string, d: Partial<Card>) =>
    req<Card>('PATCH', `/api/cards/${id}`, d),
  deleteCard: (id: string) => req<{ ok: true }>('DELETE', `/api/cards/${id}`),
};
