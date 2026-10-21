/** Query keys in one predictable shape: ['branches'], ['branches','list',{...}], ['branches','detail',id]. */
export function createKeys<Name extends string>(name: Name) {
  return {
    all: [name] as const,
    lists: () => [name, 'list'] as const,
    list: (params?: Record<string, unknown>) => [name, 'list', params ?? {}] as const,
    details: () => [name, 'detail'] as const,
    detail: (id: string) => [name, 'detail', id] as const,
  };
}
