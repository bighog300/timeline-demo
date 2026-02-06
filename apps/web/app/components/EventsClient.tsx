'use client';

import React, { useEffect, useState, type FormEvent } from 'react';

type EventItem = {
  id: string;
  title: string;
  start: string;
  end: string;
  location: string;
};

type CalendarResponse = {
  items: unknown[];
};

export default function EventsClient() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [calendarCount, setCalendarCount] = useState<number | null>(null);
  const [chatMessage, setChatMessage] = useState('');
  const [chatReply, setChatReply] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const [eventsRes, calendarRes] = await Promise.all([
          fetch('/api/events'),
          fetch('/api/calendar'),
        ]);

        if (!eventsRes.ok) {
          throw new Error('Failed to load events.');
        }

        if (!calendarRes.ok) {
          throw new Error('Failed to load calendar.');
        }

        const eventsData = (await eventsRes.json()) as EventItem[];
        const calendarData = (await calendarRes.json()) as CalendarResponse;

        if (active) {
          setEvents(eventsData);
          setCalendarCount(Array.isArray(calendarData.items) ? calendarData.items.length : 0);
        }
      } catch (error) {
        if (active) {
          setStatus(error instanceof Error ? error.message : 'Something went wrong.');
        }
      }
    };

    load();

    return () => {
      active = false;
    };
  }, []);

  const handleChatSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus(null);
    setChatReply(null);

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

      const data = (await response.json()) as { reply: string };
      setChatReply(data.reply);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to reach chat.');
    }
  };

  return (
    <section style={{ marginTop: 24 }}>
      <h2>Live API Preview</h2>
      <p>Data loads from the local Next.js API routes.</p>

      {status ? <p style={{ color: 'crimson' }}>{status}</p> : null}

      <div style={{ display: 'grid', gap: 16, marginTop: 16 }}>
        <div>
          <h3>Upcoming events</h3>
          <ul>
            {events.map((eventItem) => (
              <li key={eventItem.id}>
                <strong>{eventItem.title}</strong> — {eventItem.start} to {eventItem.end} ({eventItem.location})
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3>Calendar snapshot</h3>
          <p>{calendarCount === null ? 'Loading…' : `${calendarCount} items`}</p>
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
              Send
            </button>
          </form>
          {chatReply ? <p>Reply: {chatReply}</p> : <p>Send a message to see the reply.</p>}
        </div>
      </div>
    </section>
  );
}
