type ChatResponse = {
  reply: string;
  suggested_actions: string[];
};

const uniqueActions = (actions: string[]) => Array.from(new Set(actions));

const buildChatResponse = (message: string): ChatResponse => {
  const normalized = message.toLowerCase();

  if (!normalized) {
    return {
      reply: 'Hello! I can help plan your week. Ask about today, tomorrow, or weekend ideas.',
      suggested_actions: [
        'Show me what’s happening today',
        'Plan a weekend itinerary',
        'Summarize my timeline',
        'Suggest a low-cost activity',
      ],
    };
  }

  const hasWeekend = /weekend|saturday|sunday/.test(normalized);
  const hasToday = /\btoday\b/.test(normalized);
  const hasTomorrow = /\btomorrow\b/.test(normalized);
  const hasGallery = /gallery|exhibition|museum/.test(normalized);

  let reply = `Here’s a starting point based on “${message}.”`;
  let suggestedActions = [
    'See upcoming priorities',
    'Check my calendar',
    'Share highlights for this week',
  ];

  if (hasWeekend) {
    reply = 'Weekend planning mode on. Want cultural, food, or outdoor picks?';
    suggestedActions = [
      'Build a weekend lineup',
      'Find outdoor activities',
      'Show live music options',
      'Browse local markets',
    ];
  } else if (hasToday || hasTomorrow) {
    reply = hasToday
      ? 'For today, I can pull quick reminders and priorities.'
      : 'For tomorrow, I can line up morning, afternoon, and evening ideas.';
    suggestedActions = [
      'Show top priorities',
      'See quick calendar highlights',
      'Suggest a dinner + activity combo',
      hasTomorrow ? 'Plan a morning activity' : 'Plan an evening activity',
    ];
  } else if (hasGallery) {
    reply = 'Looking for exhibitions? I can surface galleries and museum late hours.';
    suggestedActions = [
      'Find gallery walks',
      'List museum late hours',
      'Suggest art-friendly cafes',
      'Share free exhibitions',
    ];
  }

  return {
    reply,
    suggested_actions: uniqueActions(suggestedActions),
  };
};

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const message = typeof body?.message === 'string' ? body.message.trim() : '';

  return Response.json(buildChatResponse(message));
}
