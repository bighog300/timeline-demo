'use client';

import React, { useEffect, useState, type FormEvent } from 'react';

type EventItem = {
  id: string;
  title: string;
  start: string;
  end: string;
  venue: string;
  city: string;
  category: string;
  price_range: string;
  url: string;
  tags: string[];
};

type CalendarItem = {
  id: string;
  title: string;
  start: string;
  end: string;
  location: string;
};

type CalendarResponse = {
  items: CalendarItem[];
};

type ChatResponse = {
  reply: string;
  suggested_actions: string[];
  related_events: Array<{ id: string; title: string }>;
};

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date);
};

export default function EventsClient() {
  const [events, setEvents] = useState<EventItem[] | null>(null);
  const [calendarItems, setCalendarItems] = useState<CalendarItem[] | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [chatMessage, setChatMessage] = useState('');
  const [chatReply, setChatReply] = useState<string | null>(null);
  const [chatSuggestions, setChatSuggestions] = useState<string[]>([]);
  const [chatRelatedEvents, setChatRelatedEvents] = useState<Array<{ id: string; title: string }>>(
    [],
  );
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatLoading, setChatLoading] = useState(false);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const [eventsResult, calendarResult] = await Promise.allSettled([
        fetch('/api/events'),
        fetch('/api/calendar'),
      ]);

      if (!active) {
        return;
      }

      if (eventsResult.status === 'fulfilled') {
        if (!eventsResult.value.ok) {
          setEventsError('Failed to load events.');
        } else {
          const eventsData = (await eventsResult.value.json()) as EventItem[];
          setEvents(eventsData);
        }
      } else {
        setEventsError('Failed to load events.');
      }

      if (calendarResult.status === 'fulfilled') {
        if (!calendarResult.value.ok) {
          setCalendarError('Failed to load calendar.');
        } else {
          const calendarData = (await calendarResult.value.json()) as CalendarResponse;
          setCalendarItems(Array.isArray(calendarData.items) ? calendarData.items : []);
        }
      } else {
        setCalendarError('Failed to load calendar.');
      }
    };

    load();

    return () => {
      active = false;
    };
  }, []);

  const handleChatSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setChatError(null);
    setChatReply(null);
    setChatSuggestions([]);
    setChatRelatedEvents([]);
    setChatLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: chatMessage }),
      });

      if (!response.ok) {
        throw new Error('Chat request failed.');
      }

      const data = (await response.json()) as ChatResponse;
      setChatReply(data.reply);
      setChatSuggestions(Array.isArray(data.suggested_actions) ? data.suggested_actions : []);
      setChatRelatedEvents(Array.isArray(data.related_events) ? data.related_events : []);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : 'Unable to reach chat.');
    } finally {
      setChatLoading(false);
    }
  };

  const handleSuggestionClick = (suggestion: string) => {
    setChatMessage(suggestion);
  };

  return (
    <section style={{ marginTop: 24 }}>
      <h2>Live API Preview</h2>
      <p>Data loads from the local Next.js API routes.</p>

      <div style={{ display: 'grid', gap: 16, marginTop: 16 }}>
        <div>
          <h3>Upcoming events</h3>
          {eventsError ? <p style={{ color: 'crimson' }}>{eventsError}</p> : null}
          {events === null ? <p>Loading events…</p> : null}
          <ul>
            {events?.map((eventItem) => (
              <li key={eventItem.id} style={{ marginBottom: 12 }}>
                <strong>{eventItem.title}</strong>
                <div>
                  {formatDate(eventItem.start)} • {eventItem.category} • {eventItem.city} (
                  {eventItem.venue})
                </div>
                <div>
                  Tags: {eventItem.tags.join(', ')} • {eventItem.price_range}
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3>Calendar snapshot</h3>
          {calendarError ? <p style={{ color: 'crimson' }}>{calendarError}</p> : null}
          {calendarItems === null ? (
            <p>Loading calendar…</p>
          ) : (
            <>
              <p>{`${calendarItems.length} items`}</p>
              <ul>
                {calendarItems.slice(0, 3).map((item) => (
                  <li key={item.id}>
                    {item.title} — {formatDate(item.start)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div>
          <h3>Chat stub</h3>
          <form onSubmit={handleChatSubmit} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              type="text"
              value={chatMessage}
              onChange={(event) => setChatMessage(event.target.value)}
              placeholder="Ask a question"
              style={{ flex: '1 1 220px', padding: 6 }}
            />
            <button type="submit" style={{ padding: '6px 12px' }}>
              {chatLoading ? 'Sending…' : 'Send'}
            </button>
          </form>
          {chatError ? <p style={{ color: 'crimson' }}>{chatError}</p> : null}
          {chatReply ? <p>Reply: {chatReply}</p> : <p>Send a message to see the reply.</p>}
          {chatSuggestions.length > 0 ? (
            <div style={{ marginTop: 8 }}>
              <p style={{ marginBottom: 4 }}>Suggested actions:</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {chatSuggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => handleSuggestionClick(suggestion)}
                    style={{
                      border: '1px solid #ccc',
                      borderRadius: 16,
                      padding: '4px 10px',
                      background: '#f7f7f7',
                    }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {chatRelatedEvents.length > 0 ? (
            <div style={{ marginTop: 8 }}>
              <p style={{ marginBottom: 4 }}>Related events:</p>
              <ul>
                {chatRelatedEvents.map((eventItem) => (
                  <li key={eventItem.id}>{eventItem.title}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
