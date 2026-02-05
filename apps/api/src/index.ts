import express, { type Request, type Response } from 'express';

const app = express();
const port = Number(process.env.PORT ?? 3001);

app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.get('/echo', (req: Request, res: Response) => {
  res.json({ query: req.query, body: req.body ?? null });
});

app.listen(port, () => {
  console.log(`API server listening on port ${port}`);
});
