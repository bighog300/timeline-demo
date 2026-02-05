const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '/api';

export default function HomePage() {
  return (
    <main style={{ fontFamily: 'sans-serif', padding: 24 }}>
      <h1>Timeline Demo Web App</h1>
      <p>API base URL: <code>{apiBaseUrl}</code></p>
    </main>
  );
}
