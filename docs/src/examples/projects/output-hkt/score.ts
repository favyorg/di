import { BoxModule } from './factory';

export const Score = BoxModule<{ base: number }>()(
  'Score',
  ({ base }) => base + 1
);
export type ScoreLive = typeof Score.Live;
