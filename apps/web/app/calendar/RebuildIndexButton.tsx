'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

import Button from '../components/ui/Button';
import { rebuildIndex } from '../lib/rebuildIndexClient';

type RebuildIndexButtonProps = {
  className?: string;
};

export default function RebuildIndexButton({ className }: RebuildIndexButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleClick = async () => {
    setLoading(true);
    setStatusMessage('Rebuilding…');
    setErrorMessage(null);

    const result = await rebuildIndex();

    if (result.ok) {
      setStatusMessage('Rebuild complete. Refreshing…');
      router.refresh();
      setLoading(false);
      return;
    }

    setStatusMessage(null);
    setErrorMessage(result.message);
    setLoading(false);
  };

  return (
    <div className={className}>
      <Button type="button" variant="secondary" onClick={handleClick} disabled={loading}>
        {loading ? 'Rebuilding…' : 'Rebuild index'}
      </Button>
      {statusMessage ? <p>{statusMessage}</p> : null}
      {errorMessage ? <p>{errorMessage}</p> : null}
    </div>
  );
}
