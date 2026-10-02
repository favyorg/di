import { makeModule, type HKT, type TModule } from '../../../../../di/src';

export type Result<T> = { ok: true; value: T } | { ok: false; error: unknown };

interface ResultHKT extends HKT {
  readonly type: this['_RESULT'] extends { Load(): infer Value }
    ? TModule<
        this['_NAME'],
        this['_DEPS'],
        { Load(): Promise<Result<Awaited<Value>>> }
      >
    : never;
}

export const ResultModule = makeModule({
  transformOutput: (service: { Load(): Promise<unknown> }) =>
    ({
      async Load(): Promise<Result<unknown>> {
        try {
          return { ok: true, value: await service.Load() };
        } catch (error: unknown) {
          return { ok: false, error };
        }
      },
    } as unknown as ResultHKT),
});
