type ChatResponse = {
  reply: string;
  suggested_actions: string[];
  related_events: Array<{ id: string; title: string }>;
};

const relatedEventCatalog = [
  { id: 'evt-1', title: 'City Lights Gallery Walk', keywords: ['gallery', 'exhibition'] },
  { id: 'evt-2', title: 'Saturday Jazz Social', keywords: ['weekend', 'music'] },
  { id: 'evt-6', title: 'Museum Late Hours', keywords: ['museum', 'exhibition', 'gallery'] },
  { id: 'evt-7', title: 'Sunday Farmers Market', keywords: ['weekend', 'market'] },
  { id: 'evt-9', title: 'Outdoor Movie Night', keywords: ['movie', 'night'] },
];

const uniqueActions = (actions: string[]) => Array.from(new Set(actions));

const buildChatResponse = (message: string): ChatResponse => {
  const normalized = message.toLowerCase();

  if (!normalized) {
    return {
      reply: 'Hello! I can help plan your week. Ask about today, tomorrow, or weekend ideas.',
      suggested_actions: [
        'Show me what’s happening today',
        'Plan a weekend itinerary',
        'Find gallery exhibitions',
        'Suggest a low-cost activity',
      ],
      related_events: [],
    };
  }

  const hasWeekend = /weekend|saturday|sunday/.test(normalized);
  const hasToday = /\btoday\b/.test(normalized);
  const hasTomorrow = /\btomorrow\b/.test(normalized);
  const hasGallery = /gallery|exhibition|museum/.test(normalized);

  let reply = `Here’s a starting point based on “${message}.”`;
  let suggestedActions = [
    'See upcoming events',
    'Check my calendar',
    'Share highlights for this week',
  ];

  if (hasWeekend) {
    reply = 'Weekend planning mode on. Want cultural, food, or outdoor picks?';
    suggestedActions = [
      'Build a weekend lineup',
      'Find outdoor events',
      'Show live music options',
      'Browse farmers markets',
    ];
  } else if (hasToday || hasTomorrow) {
    reply = hasToday
      ? 'For today, I can pull quick events and reminders.'
      : 'For tomorrow, I can line up morning, afternoon, and evening ideas.';
    suggestedActions = [
      'Show top events',
      'See quick calendar highlights',
      'Suggest a dinner + event combo',
      hasTomorrow ? 'Plan a morning activity' : 'Plan an evening activity',
    ];
  } else if (hasGallery) {
    reply = 'Looking for exhibitions? I can surface nearby gallery walks and museum late hours.';
    suggestedActions = [
      'Find gallery walks',
      'List museum late hours',
      'Suggest art-friendly cafes',
      'Share free exhibitions',
    ];
  }

  const related_events = relatedEventCatalog
    .filter((eventItem) => eventItem.keywords.some((keyword) => normalized.includes(keyword)))
    .slice(0, 3)
    .map(({ id, title }) => ({ id, title }));

  return {
    reply,
    suggested_actions: uniqueActions(suggestedActions),
    related_events,
  };
};

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const message = typeof body?.message === 'string' ? body.message.trim() : '';

  return Response.json(buildChatResponse(message));
}
