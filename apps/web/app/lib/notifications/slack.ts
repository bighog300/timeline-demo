export class SlackWebhookError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'SlackWebhookError';
    this.status = status;
  }
}

export const postSlackMessage = async ({
  webhookUrl,
  text,
  blocks,
}: {
  webhookUrl: string;
  text: string;
  blocks?: Array<Record<string, unknown>>;
}) => {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, ...(blocks ? { blocks } : {}) }),
  });

  if (!response.ok) {
    throw new SlackWebhookError('slack_webhook_failed', response.status);
  }
};
