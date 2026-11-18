/*
  The Overview's and Projects' way to the engine: the store's useSecurity, except that a dev URL with ?ls-mock answers from
  mock.ts instead (the mockup's sample, shaped like the contract), so both pages can be drawn and checked without the
  Demo's data. In a build MOCK is false and this is useSecurity itself.
*/
import type { RpcMethod, RpcParams, RpcResult, SecurityChange } from "@contracts";
import { MOCK, mockAnswer } from "./mock";
import { useSecurity } from "./store";

type SecurityMethod = Extract<RpcMethod, `security.${string}`>;

export function useSec<M extends SecurityMethod>(method: M, params: RpcParams<M>, on?: SecurityChange[]): { data: RpcResult<M> | null; error: string | null; loading: boolean; reload: () => void } {
  const real = useSecurity(method, params, on);
  if (!MOCK) return real;
  const data = mockAnswer(method, params);
  return data === undefined ? real : { ...real, data, error: null, loading: false };
}
