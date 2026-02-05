type VercelRequest = {
  method?: string;
  query?: Record<string, unknown>;
  body?: unknown;
};

type VercelResponse = {
  status: (statusCode: number) => VercelResponse;
  json: (body: unknown) => void;
};

export default function handler(req: VercelRequest, res: VercelResponse): void {
  res.status(200).json({
    method: req.method ?? 'GET',
    query: req.query ?? {},
    body: req.body ?? null
  });
}
