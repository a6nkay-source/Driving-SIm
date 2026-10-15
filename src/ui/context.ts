import { createContext, useContext } from 'react';
import type { GameController } from '../app/GameController';

export const ControllerContext = createContext<GameController | null>(null);

export function useController(): GameController {
  const c = useContext(ControllerContext);
  if (!c) throw new Error('GameController missing');
  return c;
}
