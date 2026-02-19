'use client';

import { useEffect, useState } from 'react';

export default function SchedulesEditor() {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/admin/schedules')
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok) throw new Error(json?.error?.message ?? 'Failed to load schedules');
        setValue(JSON.stringify(json.config, null, 2));
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load schedules');
      });
  }, []);

  const onSave = async () => {
    setSaved(false);
    setError(null);
    try {
      const parsed = JSON.parse(value) as unknown;
      const response = await fetch('/api/admin/schedules', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json?.error?.message ?? 'Failed to save schedules');
      }
      setValue(JSON.stringify(json.config, null, 2));
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save schedules');
    }
  };

  return (
    <div>
      <textarea value={value} onChange={(event) => setValue(event.target.value)} rows={24} cols={100} />
      <div>
        <button type="button" onClick={onSave}>Save schedule config</button>
      </div>
      {saved ? <p>Saved.</p> : null}
      {error ? <p>{error}</p> : null}
    </div>
  );
}
