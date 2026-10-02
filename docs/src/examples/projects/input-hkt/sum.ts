import { WrappedModule } from './factory';

export const Sum = WrappedModule<{ left: number; right: number }>()(
  'Sum',
  ({ wrapped }) => wrapped.left + wrapped.right
);
export type SumLive = typeof Sum.Live;
