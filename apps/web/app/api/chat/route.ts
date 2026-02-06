export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  const reply = message ? `You said: ${message}` : 'Hello! Tell me how I can help.';

  return Response.json({ reply });
}
