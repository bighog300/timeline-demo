type VercelRequest = {
  method?: string;
};

type VercelResponse = {
  status: (statusCode: number) => VercelResponse;
  json: (body: unknown) => void;
};

export default function handler(_req: VercelRequest, res: VercelResponse): void {
  res.status(200).json({ ok: true });
}
