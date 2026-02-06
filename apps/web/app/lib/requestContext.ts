import type { LogContext } from './logger';
import { getRequestId } from './logger';

export const createCtx = (req: Request, route: string, userHint?: string): LogContext => ({
  requestId: getRequestId(req),
  route,
  ...(userHint ? { userHint } : {}),
});

export const withRequestId = <T extends Response>(response: T, requestId: string): T => {
  response.headers.set('x-request-id', requestId);
  return response;
};
