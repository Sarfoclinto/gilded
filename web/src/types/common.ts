export type ParamsWithSignal<T> = {
  params: T;
  signal?: AbortSignal;
};
