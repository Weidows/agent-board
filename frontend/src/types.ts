export type CardType = 'note' | 'link' | 'file' | 'task';
export type CardStatus = 'open' | 'done';

export interface Board {
  id: string;
  title: string;
  desc: string;
  color: string;
  created_at: number;
  updated_at: number;
}

export interface Card {
  id: string;
  board_id: string;
  type: CardType;
  title: string;
  body: string;
  url: string;
  path: string;
  x: number;
  y: number;
  w: number;
  color: string;
  tags: string[];
  status: CardStatus;
  created_at: number;
  updated_at: number;
}

export interface State {
  meta: { v: number };
  boards: Board[];
  cards: Card[];
}
