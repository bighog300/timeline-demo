import EventsClient from './components/EventsClient';

export default function HomePage() {
  return (
    <main style={{ fontFamily: 'sans-serif', padding: 24 }}>
      <h1>Timeline Demo</h1>
      <p>Welcome to the Timeline Demo web app.</p>
      <EventsClient />
    </main>
  );
}
