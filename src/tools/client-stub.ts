import type { PlaneApi } from '@types';

export type ClientStub = {
  get?: (
    path: string,
    query?: Record<string, string | number | boolean | undefined>
  ) => Promise<unknown>;
  post?: (path: string, body: unknown) => Promise<unknown>;
  patch?: (path: string, body: unknown) => Promise<unknown>;
  delete?: (path: string) => Promise<void>;
};

// The `as T` casts below are the irreducible minimum for stubbing a generic
// client method: a fixed mock value cannot be statically typed as an arbitrary T.
export function stubClient(stub: ClientStub): PlaneApi {
  return {
    async get<T>(
      path: string,
      query?: Record<string, string | number | boolean | undefined>
    ): Promise<T> {
      return (stub.get ? await stub.get(path, query) : undefined) as T;
    },
    async post<T>(path: string, body: unknown): Promise<T> {
      return (stub.post ? await stub.post(path, body) : undefined) as T;
    },
    async patch<T>(path: string, body: unknown): Promise<T> {
      return (stub.patch ? await stub.patch(path, body) : undefined) as T;
    },
    async delete(path: string): Promise<void> {
      await stub.delete?.(path);
    },
    workspacePath: (sub: string): string => '/api/v1/workspaces/ws/' + sub.replace(/^\//, ''),
    apiPath: (sub: string): string => '/api/v1/' + sub.replace(/^\//, ''),
  };
}
