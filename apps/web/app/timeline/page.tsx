import { Suspense } from 'react';

import TimelinePageClient from './pageClient';

export default function TimelinePage() {
  return (
    <Suspense>
      <TimelinePageClient />
    </Suspense>
  );
}
